# GCE Deployment Guide

## Infrastructure Overview

The production deployment runs on Google Compute Engine with the following architecture:

| Component     | Details                                                     |
| ------------- | ----------------------------------------------------------- |
| **Instance**  | `courthive-nest` (e2-highmem-2, 16GB RAM)                   |
| **Zone**      | us-central1-a                                               |
| **OS**        | Debian 12 (Bookworm)                                        |
| **Static IP** | 34.69.50.131                                                |
| **Data Disk** | `courthive-data` (10GB pd-balanced), mounted at `/mnt/data` |
| **SSL**       | Terminated by Cloudflare (nginx listens on port 80 only)    |

### Disk Layout

- **Boot disk** (`/dev/sda`, 30GB): OS, Node.js, application code
- **Data disk** (`/dev/sdb`, 10GB): Persistent data and cache, mounted at `/mnt/data`

The data disk is separate so it can be detached and reattached to a new instance during OS upgrades.

```
/mnt/data/competition-factory-server/
├── data/           # LevelDB data (tournaments, users, providers, calendars)
└── cache/
    └── tracker/    # Tracker cache
```

The application at `/home/tennis_aip/competition-factory-server/` symlinks to the data disk:

```
data -> /mnt/data/competition-factory-server/data
cache -> /mnt/data/competition-factory-server/cache
```

## Prerequisites

### System Packages

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# nginx, Redis
sudo apt-get install -y nginx redis-server

# pnpm and PM2
sudo npm install -g pnpm@10 pm2
```

### Verify installations

```bash
node --version    # v22.x
pnpm --version    # 10.x
redis-cli ping    # PONG
nginx -v          # 1.22+
pm2 --version     # 6.x
```

## Application Setup

### Clone and build

```bash
cd /home/tennis_aip
git clone https://github.com/CourtHive/competition-factory-server.git
cd competition-factory-server
pnpm install
pnpm build
```

### Data disk setup

If setting up a new data disk:

```bash
# Format (only on first use!)
sudo mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard /dev/sdb

# Mount
sudo mkdir -p /mnt/data
sudo mount -o discard,defaults /dev/sdb /mnt/data
sudo chown tennis_aip:tennis_aip /mnt/data

# Add to fstab for automatic mount on boot
echo '/dev/sdb /mnt/data ext4 discard,defaults,nofail 0 2' | sudo tee -a /etc/fstab

# Create directories
mkdir -p /mnt/data/competition-factory-server/{data,cache}
```

### Symlink data directories

```bash
cd /home/tennis_aip/competition-factory-server
ln -sf /mnt/data/competition-factory-server/data data
ln -sf /mnt/data/competition-factory-server/cache cache
```

### Environment configuration

Create `.env` in the application root:

```env
APP_STORAGE='levelDB'
APP_NAME='Competition Factory Server'
APP_MODE='production'
APP_PORT=8383

JWT_SECRET='<generate-a-random-secret>'
JWT_VALIDITY=2h

TRACKER_CACHE='cache'

REDIS_TTL=28800000
REDIS_URL='redis://localhost:6379'
REDIS_HOST='localhost'
REDIS_USERNAME=''
REDIS_PASSWORD=''
REDIS_PORT=6379

DB_HOST=localhost
DB_PORT=3838
DB_USER=admin
DB_PASS=adminpass

MAILGUN_API_KEY='your-mailgun-api-key'
MAILGUN_DOMAIN='m.courthive.com'
MAILGUN_HOST='api.eu.mailgun.net'
```

## Process Management (PM2)

### Starting services

```bash
cd /home/tennis_aip/competition-factory-server

# Start LevelDB server
pm2 start 'npx net-level-server' --name 'hive-db' \
  --cwd /home/tennis_aip/competition-factory-server

# Start NestJS application
NODE_ENV=production pm2 start build/src/main.js --name 'Factory Server'
```

> **Note**: The `ecosystem.config.js` references `dist/src/main.js` but `pnpm build` outputs to `build/src/main.js`. Use the manual PM2 commands above instead.

### Auto-start on boot

```bash
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u tennis_aip --hp /home/tennis_aip
```

### Common PM2 commands

```bash
pm2 list                    # Show running processes
pm2 logs                    # Stream all logs
pm2 logs 'Factory Server'  # Stream app logs only
pm2 restart all             # Restart everything
pm2 reload 'Factory Server' # Zero-downtime reload
```

## Nginx Configuration

File: `/etc/nginx/sites-available/courthive.net`

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name courthive.net www.courthive.net;

    location / {
        proxy_pass http://127.0.0.1:8383;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/courthive.net /etc/nginx/sites-enabled/courthive.net
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## SSH Access

The instance uses project-level SSH keys managed by `gcloud compute ssh`.

```bash
gcloud compute ssh tennis_aip@courthive-nest --zone=us-central1-a
```

## Updating the Application

```bash
gcloud compute ssh tennis_aip@courthive-nest --zone=us-central1-a

cd /home/tennis_aip/competition-factory-server
git pull
pnpm install
pnpm build
pm2 restart 'Factory Server'
```

## Data Migration

To migrate data from an old instance:

```bash
# On old instance: tar up data
cd /path/to/old/competition-factory-server
tar czf /tmp/cfs-data.tar.gz data/ cache/tracker/

# Transfer via local machine
scp old-instance:/tmp/cfs-data.tar.gz /tmp/
gcloud compute scp /tmp/cfs-data.tar.gz tennis_aip@courthive-nest:/tmp/ --zone=us-central1-a

# On new instance: extract to data disk
cd /mnt/data/competition-factory-server
tar xzf /tmp/cfs-data.tar.gz
```
