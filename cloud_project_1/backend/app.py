"""
Cloud Voting System — EC2 Web & API Server
Serves static frontend files and connects to Amazon DynamoDB for real-time voting.
"""

import os
import json
from decimal import Decimal
from flask import Flask, request, jsonify, send_from_directory
import boto3
from botocore.exceptions import ClientError

# Locate the frontend folder (one level up from backend)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'frontend'))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')

# AWS DynamoDB Configuration
# When running on EC2 with an IAM Role, credentials are automatically resolved.
AWS_REGION = os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table('VotingApp')


# ===== Helper: Decimal to int/float for JSON =====
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


def parse_dynamo_item(item):
    """Helper to convert DynamoDB Decimal types to native Python ints/floats."""
    return json.loads(json.dumps(item, cls=DecimalEncoder))


def get_election_config():
    """Fetch election config (title, active status) from DynamoDB."""
    try:
        response = table.get_item(Key={'PK': 'ELECTION', 'SK': 'CONFIG'})
        if 'Item' in response:
            return parse_dynamo_item(response['Item'])
    except Exception as e:
        print(f"Error fetching election config: {e}")
    return {}


def fetch_candidates():
    """Fetch all candidates from DynamoDB sorted by ID."""
    try:
        response = table.scan(
            FilterExpression='begins_with(PK, :pk)',
            ExpressionAttributeValues={':pk': 'CANDIDATE#'}
        )
        candidates = []
        for item in response.get('Items', []):
            clean_item = parse_dynamo_item(item)
            candidates.append({
                'id': int(clean_item['PK'].split('#')[1]),
                'name': clean_item.get('name', ''),
                'votes': int(clean_item.get('votes', 0))
            })
        candidates.sort(key=lambda c: c['id'])
        return candidates
    except Exception as e:
        print(f"Error fetching candidates: {e}")
        return []


def clear_table():
    """Clear all items in the table for a fresh election."""
    try:
        response = table.scan()
        for item in response.get('Items', []):
            table.delete_item(
                Key={'PK': item['PK'], 'SK': item['SK']}
            )
    except Exception as e:
        print(f"Error clearing table: {e}")


# ===== Static Frontend Serving =====

@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# ===== API Endpoints =====

@app.route('/api/status', methods=['GET'])
def system_status():
    """Check if server and election are active."""
    config = get_election_config()
    candidates = fetch_candidates()
    return jsonify({
        'status': 'online',
        'active': config.get('active', False) and len(candidates) > 0,
        'title': config.get('title', 'Untitled Election'),
        'candidateCount': len(candidates)
    })


@app.route('/setup', methods=['POST'])
def setup_candidates():
    """
    POST /setup
    Initializes election with title and 2-4 candidates.
    Body: { "title": "...", "candidates": [{"id": 1, "name": "Alice"}, ...] }
    """
    try:
        data = request.get_json(force=True) or {}
        candidates = data.get('candidates', [])
        title = data.get('title', 'Untitled Election')

        if not candidates or len(candidates) < 2 or len(candidates) > 4:
            return jsonify({'error': 'Provide between 2 and 4 candidates'}), 400

        # Reset any previous election records
        clear_table()

        # Insert candidates
        for candidate in candidates:
            table.put_item(Item={
                'PK': f'CANDIDATE#{candidate["id"]}',
                'SK': 'INFO',
                'name': candidate['name'],
                'votes': 0
            })

        # Save election metadata
        table.put_item(Item={
            'PK': 'ELECTION',
            'SK': 'CONFIG',
            'title': title,
            'candidateCount': len(candidates),
            'active': True
        })

        return jsonify({
            'message': 'Election configured successfully',
            'title': title,
            'candidates': candidates
        }), 200

    except Exception as e:
        print(f"Setup Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/candidates', methods=['GET'])
def get_candidates():
    """
    GET /candidates
    Returns list of candidates, total votes, and election title.
    """
    candidates = fetch_candidates()
    config = get_election_config()
    total_votes = sum(c.get('votes', 0) for c in candidates)
    return jsonify({
        'title': config.get('title', 'Election'),
        'active': config.get('active', False) and len(candidates) > 0,
        'totalVotes': total_votes,
        'candidates': [{'id': c['id'], 'name': c['name'], 'votes': c.get('votes', 0)} for c in candidates]
    }), 200


@app.route('/vote', methods=['POST'])
def cast_vote():
    """
    POST /vote
    Atomically increments candidate vote tally.
    Body: { "candidateId": 1 }
    """
    try:
        data = request.get_json(force=True) or {}
        candidate_id = data.get('candidateId')

        if candidate_id is None:
            return jsonify({'error': 'candidateId is required'}), 400

        # Atomic counter increment
        response = table.update_item(
            Key={
                'PK': f'CANDIDATE#{candidate_id}',
                'SK': 'INFO'
            },
            UpdateExpression='SET votes = if_not_exists(votes, :zero) + :inc',
            ExpressionAttributeValues={
                ':inc': 1,
                ':zero': 0
            },
            ReturnValues='UPDATED_NEW'
        )

        return jsonify({'message': 'Vote recorded', 'status': 'success'}), 200

    except Exception as e:
        print(f"Vote Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/results', methods=['GET'])
def get_results():
    """
    GET /results
    Returns live vote counts and election metadata.
    """
    candidates = fetch_candidates()
    config = get_election_config()
    return jsonify({
        'title': config.get('title', 'Election'),
        'active': config.get('active', False) and len(candidates) > 0,
        'candidates': candidates
    }), 200


@app.route('/reset', methods=['POST'])
def reset_election():
    """
    POST /reset
    Deletes all candidates and votes from DynamoDB.
    """
    clear_table()
    return jsonify({'message': 'Election successfully reset'}), 200


# ===== Server Entry Point =====
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 80))
    print(f"🚀 Voting Machine Server starting on port {port}...")
    app.run(host='0.0.0.0', port=port, debug=False)
