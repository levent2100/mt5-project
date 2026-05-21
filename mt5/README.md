***

# Secure Multi-Instance MetaTrader 5 Cluster on Linux (Docker + Wine + noVNC)

This repository provides a production-grade, highly secure, and isolated environment to run multiple instances of MetaTrader 5 (MT5) on a Linux host (such as a GCP Ubuntu 22.04 LTS VM) using Wine, Docker, and Python.

It is designed specifically for **automated algorithmic copy-trading**, allowing you to control up to 10 independent MT5 terminals concurrently from a single master Python script on your host machine.

---

## Key Features

* **Absolute Isolation:** Windows programs (EAs, indicators, custom DLLs) are sandboxed inside Docker. They cannot see or access your host VM's file system, private SSH keys, or native code repositories.
* **Modern Wine Engine:** Built on native **Ubuntu 22.04** and official **Wine 11 Stable**, ensuring high compatibility and performance for Windows 10/11 applications.
* **Embeddable Python 3.10:** Features a lightweight, headless Windows Python environment installed directly inside Wine, keeping execution speeds fast.
* **Web-Based VNC GUI:** Stream your desktop interface securely to any device's web browser on port `8080` via noVNC. No heavyweight desktop environments or Chrome Remote Desktop needed on your host.
* **Homogeneous Scaling:** Start, stop, or customize the directory paths for any number of terminals (from 1 to 10) by simply editing the start script on your host.
* **Zero Public Ports (Tunnel Secured):** Ports are bound strictly to `127.0.0.1` (localhost). The desktop is invisible to internet scans and is accessed securely via SSH Tunneling (e.g., Termius).

---

## Directory Structure

Ensure your project folder on your host machine is structured as follows:

```text
~/mt5-project/
├── docker-compose.yml
├── copy_trader.py             # Your host Python script
└── mt5/
    ├── Dockerfile
    ├── start_cluster.sh       # Mounted host-side startup script
    └── supervisord.conf
```

---

## Phase 1: Installation & Setup

### 1. Host VM Dependencies
Install Docker and Python on your clean host VM:
```bash
# Update packages
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg python3-pip

# Add Docker GPG Key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Register repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Configure permissions (Apply without logging out)
sudo usermod -aG docker $USER && newgrp docker

# Install host-side python library
pip3 install mt5linux
```

### 2. First-Time Build
Make the start script executable and compile the container:
```bash
chmod +x mt5/start_cluster.sh
docker compose up -d --build
```
*(On first boot, the container automatically bootstraps Python 3.10, pip, and core MT5 dependencies in the background. You can monitor this progress using `docker compose logs -f`).*

---

## Phase 2: Installing Your Broker Terminals & Cloning

Because different brokers (e.g., Tickmill, IC Markets) require custom, branded installers, we perform a quick, semi-manual setup inside the VNC GUI:

### 1. Copy the Installer into the Container
Download your broker's custom installer (e.g., `tickmill5setup.exe`) to your local PC, upload it to your host VM, and copy it directly into the running container:
```bash
docker cp mt5setup.exe mt5-project-mt5-container-1:/root/
```

### 2. Run the Graphical Installer
1. Establish an SSH Local Port Forwarding tunnel in **Termius** (Local Port `8080` -> Remote Host `localhost` -> Remote Port `8080`).
2. Open your local web browser and visit `http://localhost:8080`. Enter your VNC password.
3. Right-click on the black screen and click **Terminal** (or **Xterm**).
4. Run the installer inside the VNC terminal:
   ```bash
   wine /root/tickmill5setup.exe
   ```
5. In the broker setup window, click **Settings** and set the installation path to:
   `C:\Program Files\MetaTrader 5_1`
6. Click Next, finish the setup, and log in to your first broker account.

### 3. Duplicate to 10 Copies Instantly
You do not need to run the installer 9 more times. Open your VNC terminal (or your host terminal) and run this single loop to duplicate your configured broker folder:
```bash
for i in $(seq 2 10); do cp -r "/config/.wine/drive_c/Program Files/MetaTrader 5_1" "/config/.wine/drive_c/Program Files/MetaTrader 5_$i"; done
```

---

## Phase 3: Daily Operations (Start / Stop)

Once your initial setup (accounts, logins, indicators) is configured, managing your power state correctly ensures you never lose data.

### 1. Stopping the Cluster (Saves Your Data)
When you want to stop trading or pause your server, **always use stop**:
```bash
docker compose stop
```
* **What it does:** Gently pauses the container's virtual hard drive.
* **Is your data safe?** **Yes.** All your active logins, broker settings, and chart history are saved.

### 2. Starting the Cluster (Resumes Automatically)
To resume trading, run:
```bash
docker compose start
```
* **What it does:** Wakes the container up. The startup script will read your active lines, automatically launch your configured terminals side-by-side in portable mode, and open your Python RPC bridges in less than 2 seconds.

### 3. DANGER: Avoid Using `down`
```bash
docker compose down
```
* **Why?** This command stops **and completely deletes** the container. Because we do not map a persistent volume to preserve the sandbox file system, running `down` will **wipe out all your logged-in broker accounts and chart history**. Avoid using this unless you intend to start from a clean slate.

---

## Phase 4: Customizing Active Terminals Dynamically

Since we mounted `start_cluster.sh` as a live volume, you can customize your active terminals on the fly:

1. Open `mt5/start_cluster.sh` on your host VM.
2. In the **MT5** section, uncomment the specific terminals you want to run (remove the `#`):
   ```bash
   # Instance 5 (Active)
   wine "/config/.wine/drive_c/Program Files/MetaTrader 5_5/terminal64.exe" /portable &
   sleep 3
   ```
3. In the **Python Bridges** section, uncomment the corresponding bridge ports:
   ```bash
   # Bridge 5 - Port 18816 (Active)
   wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18816 &
   sleep 1
   ```
4. Save the file and apply changes instantly (1 second):
   ```bash
   docker compose stop && docker compose start
   ```

---

## Phase 5: When is a Rebuild Required?

You **only** need to run a rebuild if you modify the system dependencies inside the **`Dockerfile`** (for example, adding another Linux utility like `tint2` or custom system fonts). 

To perform a safe system upgrade without losing your files, follow these steps:

1. Ensure your container is stopped:
   ```bash
   docker compose stop
   ```
2. Re-compile the Dockerfile layers:
   ```bash
   docker compose build
   ```
3. Start the container with the updated image:
   ```bash
   docker compose up -d
   ```
   *(Note: Do not use `docker compose down` during this process to ensure your virtual C: drive state is preserved).*

---

## Phase 6: Resource Optimization for Multi-Instance Setups

Running multiple graphical applications inside a single container can be memory intensive. To run 10 terminals stably on lower-tier VMs (e.g., 8GB RAM):

1. **Market Watch Cleanup:** Inside each MT5 terminal, right-click inside the Market Watch window and select **Hide All**. Only show the exact symbol you are actively trading. This reduces background CPU ticks by up to 70%.
2. **Minimize Charts:** Go to *Tools -> Options -> Charts* and change **Max bars in chart** to `5000`. Keep terminal windows minimized inside the VNC workspace when not manually inspecting them to bypass the Wine X11 drawing loop entirely.


docker compose exec mt5-container cat /var/log/mt5_cluster.err
docker compose exec mt5-container cat /var/log/mt5_cluster.log