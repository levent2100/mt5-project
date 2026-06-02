#!/bin/bash
export DISPLAY=:1
export WINEPREFIX="/config/.wine"
export HOME="/root"

# --- SYSTEM INIT ---
if [ ! -d "/config/.wine/drive_c/Python310" ]; then
    echo "=== Initializing Wine Prefix and Python ==="
    wineboot -u
    wine reg add "HKCU\Software\Wine" /v Version /t REG_SZ /d "win10" /f
    
    # Extract Python
    cd /tmp
    wget https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip
    mkdir -p "/config/.wine/drive_c/Python310"
    unzip python-3.10.11-embed-amd64.zip -d "/config/.wine/drive_c/Python310"
    rm python-3.10.11-embed-amd64.zip
    
    # Enable site-packages
    sed -i 's/#import site/import site/' "/config/.wine/drive_c/Python310/python310._pth"
    
    # Install Pip
    wget https://bootstrap.pypa.io/get-pip.py
    wine /config/.wine/drive_c/Python310/python.exe get-pip.py
    rm get-pip.py
    
    # Install Python Packages (MetaTrader5, numpy, mt5linux, and TA-Lib)
    wine /config/.wine/drive_c/Python310/python.exe -m pip install --upgrade pip
    wine /config/.wine/drive_c/Python310/python.exe -m pip install MetaTrader5 mt5linux TA-Lib
    cd /root
fi

# --- DYNAMIC INSTALLATION ENDS HERE ---

# FIX: Clean up stale X11 lock files from previous stops/crashes
echo "Cleaning up any leftover X11 lock files..."
rm -f /tmp/.X1-lock
rm -f /tmp/.X11-unix/X1
# -----------------------------------------------------------

echo "1. Starting Virtual Framebuffer (Xvfb)..."
Xvfb :1 -screen 0 1024x768x24 &
sleep 2

echo "2. Starting Openbox Window Manager..."
openbox-session &
sleep 1

echo "2b. Starting Tint2 Taskbar Panel..."
tint2 &
sleep 1

# FIX: Start clipboard synchronization managers [1]
echo "2c. Starting Clipboard Managers..."
autocutsel -fork
autocutsel -s PRIMARY -fork
sleep 1

echo "3. Starting VNC Server..."
if [ -n "$VNC_PASSWD" ]; then
    mkdir -p ~/.vnc
    x11vnc -storepasswd "$VNC_PASSWD" ~/.vnc/passwd
    x11vnc -display :1 -rfbauth ~/.vnc/passwd -forever -shared -noclipboard &
else
    x11vnc -display :1 -nopw -forever -shared -noclipboard &
fi
sleep 1

echo "4. Starting noVNC Web Server on port 8080..."
websockify --web /usr/share/novnc/ 8080 localhost:5900 &
sleep 2


# =====================================================================
# 5. STARTING MT5 TERMINALS (Uncomment or change paths as needed)
# =====================================================================
echo "5. Starting MT5 instances..."

# Optimize Wine's X11 clipboard integration
wine reg add "HKCU\Software\Wine\X11 Driver" /v UsePrimarySelection /t REG_SZ /d "y" /f

# Dynamic loop for starting MT5 Instances 1 to 11
for i in {1..11}; do
    TERMINAL_DIR="/config/.wine/drive_c/Program Files/MetaTrader 5_${i}"
    EXE_PATH="${TERMINAL_DIR}/terminal64.exe"
    if [ -f "${EXE_PATH}" ]; then
        echo "Configuring terminal.ini options to enable Algo Trading for Instance ${i}..."
        python3 -c "
path = '${TERMINAL_DIR}/Config/terminal.ini'
import os
if os.path.exists(path):
    with open(path, 'r', encoding='utf-16') as f:
        content = f.read()
    target = '[Options]'
    replacement = '[Options]\r\nExpertEnable=1\r\nExpertInputs=1\r\nExpertImport=1\r\nExpertConfirm=0\r\n'
    if target in content:
        content = content.replace(target, replacement)
    else:
        content += '\r\n' + replacement
    with open(path, 'w', encoding='utf-16') as f:
        f.write(content)
    print('Updated terminal.ini successfully!')
else:
    print('terminal.ini not found, skipping configuration.')
"
        wine "${EXE_PATH}" /portable &
        sleep 3
    fi
done


# =====================================================================
# 6. STARTING CUSTOM HTTP BRIDGES
# =====================================================================
echo "6. Starting Custom HTTP Bridges..."

# Dynamic loop for starting HTTP Bridges 1 to 11
for i in {1..11}; do
    BRIDGE_PATH="/root/scripts/mt5_http_bridge${i}.py"
    if [ -f "${BRIDGE_PATH}" ]; then
        echo "Starting HTTP Bridge ${i}..."
        wine /config/.wine/drive_c/Python310/python.exe "${BRIDGE_PATH}" &
        sleep 1
    fi
done

wait