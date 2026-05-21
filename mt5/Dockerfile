FROM ubuntu:22.04

# Prevent interactive keyboard/timezone prompts during building
ENV DEBIAN_FRONTEND=noninteractive

# Install core utilities and WineHQ prerequisites
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg2 \
    software-properties-common \
    wget \
    dpkg \
    && rm -rf /var/lib/apt/lists/*

# Enable 32-bit architecture (required for Wine)
RUN dpkg --add-architecture i386

# Install WineHQ Stable, Virtual Desktop tools, noVNC, supervisor, unzip, xterm, AND tint2 (Taskbar)
RUN mkdir -pm755 /etc/apt/keyrings && \
    wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key && \
    wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources

RUN apt-get update && apt-get install -y \
    winehq-stable \
    xvfb \
    x11vnc \
    openbox \
    novnc \
    websockify \
    supervisor \
    unzip \
    xterm \
    tint2 \
    libgnutls30:i386 \
    && rm -rf /var/lib/apt/lists/*

# Create a symlink so the web interface loads automatically when visiting port 8080
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Set up global environment variables for consistency
ENV WINEPREFIX=/config/.wine
ENV WINEARCH=win64
ENV WINEDEBUG=-all
ENV WINEDLLOVERRIDES="mscoree,mshtml="
ENV WINEAUDIODEV=dummy
ENV HOME=/root
ENV XDG_RUNTIME_DIR=/tmp
WORKDIR /root/

# Create the parent directory for WINEPREFIX
RUN mkdir -p /config

# Copy configurations and startup scripts
COPY ./mt5/start_cluster.sh /root/start_cluster.sh
RUN chmod +x /root/start_cluster.sh
COPY ./mt5/supervisord.conf /etc/supervisor/conf.d/mt5.conf

# Port mappings inside the container
EXPOSE 8080
EXPOSE 58809-58818

CMD ["/usr/bin/supervisord"]