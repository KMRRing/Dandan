#!/usr/bin/env bash
# Lab workers on Alibaba Cloud spot instances (10 November 2026: Google's free trial caps the lab at 12 cores). Run in Alibaba
# Cloud Shell, where the aliyun CLI is already signed in:
#   curl -fsSL https://raw.githubusercontent.com/KMRRing/Dandan/main/lab/alibaba.sh | KEY=<the key, base64> N=4 bash
# It finds or makes a network (a VPC, a vSwitch, a security group with no way in), picks the first compute-optimized AMD type
# offered as spot in the region, and starts N instances that each install Node 22 and run lab/worker.mjs against the Google
# bucket (LAB_FILL: they queue self-play when the queue runs dry), signed in with the service-account key KEY (base64 of the
# JSON). Each runs until its spot capacity is taken back or LAB_MAX_HOURS passes, then shuts itself down (and stops costing).
#   stop all:  curl -fsSL https://raw.githubusercontent.com/KMRRing/Dandan/main/lab/alibaba.sh | STOP=1 bash
# Settings: REGION (eu-central-1, Frankfurt), N (instances, 2), TYPES (tried in order), HOURS (most a worker runs, 72).
set -euo pipefail
REGION=${REGION:-eu-central-1}; N=${N:-2}; HOURS=${HOURS:-72}
TYPES=${TYPES:-"ecs.c8a.4xlarge ecs.c8a.2xlarge ecs.c7a.4xlarge ecs.c7a.2xlarge ecs.c9a.4xlarge ecs.c8i.4xlarge ecs.c7.4xlarge"}
TAG=dandan-lab
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

if [ "${STOP:-}" = 1 ]; then
  ids=$(aliyun ecs DescribeInstances --RegionId "$REGION" --Tag.1.Key "$TAG" --Tag.1.Value 1 --PageSize 100 | j "' '.join(i['InstanceId'] for i in d['Instances']['Instance'])")
  for id in $ids; do aliyun ecs DeleteInstance --InstanceId "$id" --Force true >/dev/null && echo "deleted $id"; done
  echo "all lab instances in $REGION deleted"; exit 0
fi
[ -n "${KEY:-}" ] || { echo "KEY (the service-account key, base64) is needed"; exit 1; }

# a type offered as spot here, and a zone that has it
TYPE=""; ZONE=""
for t in $TYPES; do
  z=$(aliyun ecs DescribeAvailableResource --RegionId "$REGION" --DestinationResource InstanceType --InstanceChargeType PostPaid --SpotStrategy SpotAsPriceGo --InstanceType "$t" \
      | j "next((z['ZoneId'] for z in d.get('AvailableZones',{}).get('AvailableZone',[]) if z.get('Status')=='Available' and any(r.get('Status')=='Available' for a in z['AvailableResources']['AvailableResource'] for r in a['SupportedResources']['SupportedResource'])), '')" 2>/dev/null || true)
  if [ -n "$z" ]; then TYPE=$t; ZONE=$z; break; fi
done
[ -n "$TYPE" ] || { echo "none of these types is offered as spot in $REGION: $TYPES"; exit 1; }
echo "type $TYPE in $ZONE"

# the network: the lab's own, made once
VPC=$(aliyun vpc DescribeVpcs --RegionId "$REGION" --VpcName "$TAG" | j "next((v['VpcId'] for v in d['Vpcs']['Vpc']), '')")
if [ -z "$VPC" ]; then VPC=$(aliyun vpc CreateVpc --RegionId "$REGION" --VpcName "$TAG" --CidrBlock 172.16.0.0/16 | j "d['VpcId']"); sleep 10; fi
VSW=$(aliyun vpc DescribeVSwitches --RegionId "$REGION" --VpcId "$VPC" --ZoneId "$ZONE" | j "next((v['VSwitchId'] for v in d['VSwitches']['VSwitch']), '')")
if [ -z "$VSW" ]; then
  n=$(aliyun vpc DescribeVSwitches --RegionId "$REGION" --VpcId "$VPC" | j "len(d['VSwitches']['VSwitch'])")
  VSW=$(aliyun vpc CreateVSwitch --RegionId "$REGION" --VpcId "$VPC" --ZoneId "$ZONE" --CidrBlock "172.16.$((n * 16)).0/20" --VSwitchName "$TAG" | j "d['VSwitchId']"); sleep 5
fi
SG=$(aliyun ecs DescribeSecurityGroups --RegionId "$REGION" --VpcId "$VPC" --SecurityGroupName "$TAG" | j "next((g['SecurityGroupId'] for g in d['SecurityGroups']['SecurityGroup']), '')")
[ -n "$SG" ] || SG=$(aliyun ecs CreateSecurityGroup --RegionId "$REGION" --VpcId "$VPC" --SecurityGroupName "$TAG" | j "d['SecurityGroupId']")
IMAGE=$(aliyun ecs DescribeImages --RegionId "$REGION" --ImageOwnerAlias system --OSType linux --Architecture x86_64 --ImageName "ubuntu_22_04_x64*" --PageSize 50 | j "sorted(d['Images']['Image'], key=lambda i: i['CreationTime'])[-1]['ImageId']")
echo "network $VPC / $VSW / $SG, image $IMAGE"

# what each instance runs at start
read -r -d '' BOOT <<EOF || true
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

aliyun ecs RunInstances --RegionId "$REGION" --ZoneId "$ZONE" --InstanceType "$TYPE" --ImageId "$IMAGE" \
  --SecurityGroupId "$SG" --VSwitchId "$VSW" --InstanceChargeType PostPaid --SpotStrategy SpotAsPriceGo --SpotDuration 0 \
  --InternetChargeType PayByTraffic --InternetMaxBandwidthOut 10 --SystemDisk.Category cloud_essd --SystemDisk.Size 40 \
  --InstanceName "$TAG" --Tag.1.Key "$TAG" --Tag.1.Value 1 --Amount "$N" --UserData "$(printf '%s' "$BOOT" | base64 -w0)" \
  | j "'started: ' + ' '.join(d['InstanceIdSets']['InstanceIdSet'])"
echo "they take a few minutes to install and join the queue; stop them all with STOP=1 (see the top of this script)"
