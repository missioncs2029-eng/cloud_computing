# ☁️ Cloud-Based Voting System

A software-based voting system built on AWS, replacing a physical button voting machine with realistic 3D dome buttons, audio feedback, and cloud persistence.

## AWS Services Used
| Service | Purpose | Cloud Model |
|---------|---------|:-----------:|
| **Amazon EC2** | Hosts the web frontend & Python API server | **IaaS** |
| **Amazon DynamoDB** | Stores candidates, votes, and election configuration | **PaaS** |
| **AWS IAM** | Instance Profile granting EC2 secure access to DynamoDB | Security |
| **Amazon VPC** | Isolated virtual network, Public Subnet, & Security Group firewall | Networking |

## Pages
1. **Setup** (`index.html`) — Configure election title, pick 2-4 candidates, name them
2. **Vote** (`vote.html`) — Realistic 3D physical buttons, digital counter, EVM beep, 2s auto-reset
3. **Results** (`results.html`) — Live Chart.js analytics, distribution bar chart, share pie chart, reset modal

## Project Structure
```
├── frontend/
│   ├── index.html        # Setup page
│   ├── vote.html         # Voting page
│   ├── results.html      # Results page
│   ├── css/styles.css    # Industrial voting machine styling
│   └── js/               # setup.js, vote.js, results.js
├── backend/
│   ├── app.py            # Flask Web & DynamoDB API server for EC2
│   └── requirements.txt  # Python dependencies (flask, boto3)
└── README.md
```

## How to Run
- **Locally:** Open `frontend/index.html` directly in your browser (uses `localStorage` offline).
- **On AWS EC2:** Run `sudo python3 backend/app.py` on the EC2 instance and visit `http://<EC2-Public-IP>/`.

## Author
Cloud Computing Semester Project — 2026
