#!/bin/bash
# Instala el scraper en WSL (Ubuntu). En Windows 11 el binario nativo falla
# ("target closed", incidencia #137 del proyecto original); en Linux funciona.
set -e
VERSION=1.18.1
mkdir -p /opt/gmaps && cd /opt/gmaps
if [ ! -x gmaps ]; then
  curl -sL -o gmaps "https://github.com/gosom/google-maps-scraper/releases/download/v${VERSION}/google_maps_scraper-${VERSION}-linux-amd64"
  chmod +x gmaps
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Librerías que necesita Chromium (nombres de Ubuntu 24.04, con alternativa para 22.04).
apt-get install -y -qq libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0t64 fonts-liberation >/dev/null 2>&1 \
 || apt-get install -y -qq libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 fonts-liberation >/dev/null
echo "Instalado en /opt/gmaps"
