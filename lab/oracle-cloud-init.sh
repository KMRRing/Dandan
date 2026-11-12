#!/bin/bash
# Oracle Cloud machine for the Dandan lab (11 November 2026). Paste this whole file into "Initialization script" (cloud-init)
# when creating an instance, after replacing PASTE_KEY_HERE with the bucket key (the same base64 line used for AWS). The machine
# installs Node 22 and git, then runs lab/worker.mjs on every core against the lab bucket, restarting it if it ever stops.
# Works on Ampere A1 (ARM) and on AMD/Intel shapes, Oracle Linux or Ubuntu.
KEY='PASTE_KEY_HERE'
set -e
if command -v dnf >/dev/null; then dnf -y install git tar xz >/dev/null; else apt-get update -q && apt-get install -y -q git xz-utils >/dev/null; fi
ARCH=$(uname -m); case "$ARCH" in aarch64) A=arm64;; *) A=x64;; esac
curl -fsSL "https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-$A.tar.xz" | tar -xJ -C /opt
ln -sf /opt/node-v22.11.0-linux-$A/bin/node /usr/local/bin/node
echo "$KEY" | base64 -d > /opt/lab-key.json && chmod 600 /opt/lab-key.json
cat > /opt/lab-run.sh <<'EOF'
#!/bin/bash
while true; do
  cd / && rm -rf /opt/dandan && git clone -q --depth 1 https://github.com/KMRRing/Dandan.git /opt/dandan && cd /opt/dandan &&
  LAB_BUCKET=dandan-lab-807207481983 LAB_KEY=/opt/lab-key.json LAB_CLOUD=oracle LAB_FILL=1 LAB_POLL_SEC=30 LAB_MAX_HOURS=12 node lab/worker.mjs
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
