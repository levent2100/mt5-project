#!/bin/bash
export DISPLAY=:1
export WINEPREFIX="/config/.wine"
export HOME="/root"

# --- FIRST BOOT DYNAMIC INSTALLATION ---
if [ ! -d "/config/.wine/drive_c/Python310" ]; then
    echo "=========================================================="
    echo "=== FIRST BOOT: Installing Python, Pip, and MetaTrader ==="
    echo "=========================================================="
    
    # 1. Initialize Wine Prefix & set Windows 10
    wineboot -u
    wine reg add "HKCU\Software\Wine" /v Version /t REG_SZ /d "win10" /f
    
    # 2. Download and Extract Python Embeddable ZIP
    cd /tmp
    wget https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip
    mkdir -p "/config/.wine/drive_c/Python310"
    unzip python-3.10.11-embed-amd64.zip -d "/config/.wine/drive_c/Python310"
    rm python-3.10.11-embed-amd64.zip
    
    # 3. Enable site-packages in Python
    sed -i 's/#import site/import site/' "/config/.wine/drive_c/Python310/python310._pth"
    
    # 4. Install Pip
    wget https://bootstrap.pypa.io/get-pip.py
    wine /config/.wine/drive_c/Python310/python.exe get-pip.py
    rm get-pip.py
    
    # 5. Install MT5 and mt5linux packages
    wine /config/.wine/drive_c/Python310/python.exe -m pip install --upgrade pip
    wine /config/.wine/drive_c/Python310/python.exe -m pip install MetaTrader5 mt5linux
    
    # 6. Install MetaTrader 5
    wget https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
    xvfb-run wine mt5setup.exe /auto || true
    rm -f mt5setup.exe
    
    # 7. Clone the installation folder 10 times
    for i in $(seq 1 10); do
        cp -r "/config/.wine/drive_c/Program Files/MetaTrader 5" "/config/.wine/drive_c/Program Files/MetaTrader 5_$i"
    done
    
    echo "=========================================================="
    echo "=== FIRST BOOT INSTALLATION COMPLETE ====================="
    echo "=========================================================="
    cd /root
fi
# ---------------------------------------

echo "1. Starting Virtual Framebuffer (Xvfb)..."
Xvfb :1 -screen 0 1280x1024x24 &
sleep 2

echo "2. Starting Openbox Window Manager (Provides draggable windows)..."
openbox-session &
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
sleep 1

echo "5. Starting 10 MT5 instances in portable mode..."
for i in $(seq 1 10); do
    echo "Launching MT5 Terminal $i..."
    wine "/config/.wine/drive_c/Program Files/MetaTrader 5_$i/terminal64.exe" /portable &
    sleep 3
done

echo "6. Starting 10 Python Bridges (Ports 18812 - 18821)..."
for i in $(seq 1 10); do
    port=$((18811 + i))
    echo "Launching Python Bridge on port $port..."
    wine /config/.wine/drive_c/Python310/python.exe -m mt5linux --host 0.0.0.0 --port $port &
    sleep 1
done

# Keep script running
wait