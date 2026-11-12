#!/bin/bash
# A cloud machine for the Dandan lab (Rackspace Spot "Cloud-init", 12 November 2026). Paste this whole file in when creating the
# machines, after replacing the line PASTE THE WHOLE KEY FILE HERE with the key's JSON file, { to }. The machine waits out the
# system's own updater, installs Node 22, and runs lab/worker.mjs on every core against the lab bucket, restarting it if it stops.
# (Fable's fixes, 12 Nov: cd / before the code is deleted and fetched again, packages and Node retried on a fresh machine.)
CLOUD='rackspace'
set -e
export DEBIAN_FRONTEND=noninteractive
# git, xz and curl are used as found; if one is missing it is installed, waiting while the system's own updater is busy
until command -v git >/dev/null && command -v xz >/dev/null && command -v curl >/dev/null; do
  if command -v dnf >/dev/null; then dnf -y install git tar xz curl >/dev/null 2>&1 || sleep 20
  else apt-get update -q >/dev/null 2>&1 || true; apt-get -o DPkg::Lock::Timeout=300 install -y -q git xz-utils curl ca-certificates >/dev/null 2>&1 || sleep 20; fi
done
ARCH=$(uname -m); case "$ARCH" in aarch64) A=arm64;; *) A=x64;; esac
curl -fsSL --retry 5 --retry-delay 10 -o /tmp/node.tar.xz "https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-$A.tar.xz"
tar -xJf /tmp/node.tar.xz -C /opt
rm -f /tmp/node.tar.xz
ln -sf /opt/node-v22.11.0-linux-$A/bin/node /usr/local/bin/node
cat > /opt/lab-key.json <<'KEYFILE'
PASTE THE WHOLE KEY FILE HERE
KEYFILE
chmod 600 /opt/lab-key.json
cat > /opt/lab-run.sh <<EOF
#!/bin/bash
while true; do
  cd / && rm -rf /opt/dandan && git clone -q --depth 1 https://github.com/KMRRing/Dandan.git /opt/dandan && cd /opt/dandan &&
  LAB_BUCKET=dandan-lab-807207481983 LAB_KEY=/opt/lab-key.json LAB_CLOUD=$CLOUD LAB_FILL=1 LAB_POLL_SEC=30 LAB_MAX_HOURS=12 node lab/worker.mjs
  sleep 30
done
EOF
chmod +x /opt/lab-run.sh
cat > /etc/systemd/system/dandan-lab.service <<'EOF'
[Unit]
Description=Dandan lab worker
After=network-online.target
[Service]
ExecStart=/opt/lab-run.sh
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now dandan-lab.service
