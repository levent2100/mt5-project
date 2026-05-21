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
    
    # Install Python Packages
    wine /config/.wine/drive_c/Python310/python.exe -m pip install --upgrade pip
    wine /config/.wine/drive_c/Python310/python.exe -m pip install MetaTrader5 mt5linux
    cd /root
fi

echo "1. Starting Virtual Framebuffer (Xvfb)..."
Xvfb :1 -screen 0 1280x1024x24 &
sleep 2

echo "2. Starting Openbox Window Manager..."
openbox-session &
sleep 1

# FIX: Start the lightweight taskbar panel
echo "2b. Starting Tint2 Taskbar Panel..."
tint2 &
sleep 1


echo "3. Starting VNC Server..."
if [ -n "$VNC_PASSWD" ]; then
    mkdir -p ~/.vnc
    x11vnc -storepasswd "$VNC_PASSWD" ~/.vnc/passwd
    x11vnc -display :1 -rfbauth ~/.vnc/passwd -forever -shared -bg &
else
    x11vnc -display :1 -nopw -forever -shared -bg &
fi
sleep 1

echo "4. Starting noVNC Web Server on port 8080..."
websockify --web /usr/share/novnc/ 8080 localhost:5900 &
sleep 2


# =====================================================================
# 5. STARTING MT5 TERMINALS (Uncomment or change paths as needed)
# =====================================================================
echo "5. Starting MT5 instances..."

# Instance 1 (Active by default)
wine "/config/.wine/drive_c/Program Files/MetaTrader 5_1/terminal64.exe" /portable &
sleep 3

# Instance 2
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_2/terminal64.exe" /portable &
# sleep 3

# Instance 3
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_3/terminal64.exe" /portable &
# sleep 3

# Instance 4
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_4/terminal64.exe" /portable &
# sleep 3

# Instance 5
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_5/terminal64.exe" /portable &
# sleep 3

# Instance 6
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_6/terminal64.exe" /portable &
# sleep 3

# Instance 7
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_7/terminal64.exe" /portable &
# sleep 3

# Instance 8
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_8/terminal64.exe" /portable &
# sleep 3

# Instance 9
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_9/terminal64.exe" /portable &
# sleep 3

# Instance 10
# wine "/config/.wine/drive_c/Program Files/MetaTrader 5_10/terminal64.exe" /portable &
# sleep 3


# =====================================================================
# 6. STARTING PYTHON BRIDGES (Uncomment corresponding ports)
# =====================================================================
echo "6. Starting Python Bridges..."

# Bridge 1 - Port 18812 (Active by default)
wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18812 &
sleep 1

# Bridge 2 - Port 18813
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18813 &
# sleep 1

# Bridge 3 - Port 18814
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18814 &
# sleep 1

# Bridge 4 - Port 18815
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18815 &
# sleep 1

# Bridge 5 - Port 18816
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18816 &
# sleep 1

# Bridge 6 - Port 18817
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18817 &
# sleep 1

# Bridge 7 - Port 18818
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18818 &
# sleep 1

# Bridge 8 - Port 18819
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18819 &
# sleep 1

# Bridge 9 - Port 18820
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18820 &
# sleep 1

# Bridge 10 - Port 18821
# wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port 18821 &
# sleep 1

wait