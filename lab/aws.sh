#!/usr/bin/env bash
# Lab workers on AWS spot instances (10 November 2026: Google's free trial caps the lab at 12 cores). Run in AWS CloudShell,
# where the aws CLI is already signed in, in the region you want:
#   curl -fsSL https://raw.githubusercontent.com/KMRRing/Dandan/main/lab/aws.sh | KEY=<the key, base64> N=2 bash
# It uses the default VPC, makes a security group with no way in (once), picks the first compute-optimized type in TYPES the
# region offers, and starts N one-time spot instances that each install Node 22 and run lab/worker.mjs against the Google bucket
# (LAB_FILL: they queue self-play when the queue runs dry), signed in with the service-account key KEY (base64 of its JSON).
# Each shuts itself down, and so is terminated and stops costing, when spot capacity is taken back or HOURS pass.
#   stop all:  curl -fsSL https://raw.githubusercontent.com/KMRRing/Dandan/main/lab/aws.sh | STOP=1 bash
# Settings: N (instances, 2), TYPES (tried in order), HOURS (most a worker runs, 72).
set -euo pipefail
N=${N:-2}; HOURS=${HOURS:-72}
TYPES=${TYPES:-"c7a.4xlarge c6a.4xlarge c7i.4xlarge c6i.4xlarge c5a.4xlarge"}
TAG=dandan-lab
REGION=$(aws configure get region || echo "${AWS_REGION:-us-east-1}")

if [ "${STOP:-}" = 1 ]; then
  ids=$(aws ec2 describe-instances --filters "Name=tag:$TAG,Values=1" "Name=instance-state-name,Values=pending,running" --query 'Reservations[].Instances[].InstanceId' --output text)
  [ -n "$ids" ] && aws ec2 terminate-instances --instance-ids $ids --output text >/dev/null
  echo "terminated in $REGION: ${ids:-none}"; exit 0
fi
[ -n "${KEY:-}" ] || { echo "KEY (the service-account key, base64) is needed"; exit 1; }

TYPE=""
for t in $TYPES; do
  if [ -n "$(aws ec2 describe-instance-type-offerings --filters "Name=instance-type,Values=$t" --query 'InstanceTypeOfferings[0].InstanceType' --output text | grep -v None)" ]; then TYPE=$t; break; fi
done
[ -n "$TYPE" ] || { echo "none of these types is offered in $REGION: $TYPES"; exit 1; }
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC" != "None" ] || { echo "no default VPC in $REGION"; exit 1; }
SG=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC" "Name=group-name,Values=$TAG" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name "$TAG" --description "Dandan lab workers: no inbound" --vpc-id "$VPC" --query GroupId --output text)
fi
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id --query Parameter.Value --output text)
echo "region $REGION, type $TYPE, image $AMI, security group $SG"

BOOT=$(cat <<EOF
#!/bin/bash
exec > /var/log/dandan-lab.log 2>&1
set -x
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq git xz-utils curl
curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | tar -xJ -C /opt
export PATH=/opt/node-v22.11.0-linux-x64/bin:\$PATH
echo '$KEY' | base64 -d > /root/lab-key.json
git clone --depth 1 https://github.com/KMRRing/Dandan.git /opt/dandan
cd /opt/dandan
LAB_BUCKET=dandan-lab-807207481983 LAB_KEY=/root/lab-key.json LAB_FILL=1 LAB_SLOTS=\$(nproc) LAB_POLL_SEC=30 LAB_MAX_HOURS=$HOURS node lab/worker.mjs
shutdown -h now
EOF
)

aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --count "$N" --security-group-ids "$SG" \
  --instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=one-time,InstanceInterruptionBehavior=terminate}' \
  --instance-initiated-shutdown-behavior terminate --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=$TAG,Value=1},{Key=Name,Value=$TAG}]" \
  --user-data "$BOOT" --query 'Instances[].InstanceId' --output text | sed 's/^/started: /'
echo "they take a few minutes to install and join the queue; stop them all with STOP=1 (see the top of this script)"
