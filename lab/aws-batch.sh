#!/usr/bin/env bash
# Lab workers on AWS Batch (10 November 2026). Needs the Batch compute environment "Dandan" (managed, spot) made in the console.
# Run in AWS CloudShell, in that environment's region:
#   curl -fsSL https://raw.githubusercontent.com/KMRRing/Dandan/main/lab/aws-batch.sh | KEY=<the key, base64> N=4 bash
# It caps the compute environment at N x 16 cores (the cost guard), makes the job queue "dandan-lab" and the job definition
# "dandan-lab" (Node 22 container that clones the repo and runs lab/worker.mjs against the Google bucket, LAB_FILL on), and
# submits N workers of 16 cores each. A worker reclaimed by spot is retried (up to 5 times); each stops after HOURS.
#   stop all:  curl -fsSL https://raw.githubusercontent.com/KMRRing/Dandan/main/lab/aws-batch.sh | STOP=1 bash
# A rerun without KEY reuses the key from the last job definition (e.g. N=16 HOURS=12 to resize).
# Settings: N (workers, 4), HOURS (most a worker runs, 48), ENV (compute environment name, Dandan).
set -euo pipefail
N=${N:-4}; HOURS=${HOURS:-48}; ENV=${ENV:-Dandan}; Q=dandan-lab; CORES=16

if [ "${STOP:-}" = 1 ]; then
  for st in SUBMITTED PENDING RUNNABLE STARTING RUNNING; do
    for id in $(aws batch list-jobs --job-queue "$Q" --job-status $st --query 'jobSummaryList[].jobId' --output text); do
      aws batch terminate-job --job-id "$id" --reason "stopped by aws-batch.sh" && echo "stopped $id"
    done
  done
  aws batch update-compute-environment --compute-environment "$ENV" --compute-resources minvCpus=0,desiredvCpus=0 >/dev/null || true
  echo "all lab jobs stopped"; exit 0
fi
if [ -z "${KEY:-}" ]; then  # reuse the key from the last job definition, so a rerun needs no key
  KEY=$(aws batch describe-job-definitions --job-definition-name "$Q" --status ACTIVE \
    --query 'reverse(sort_by(jobDefinitions,&revision))[0].containerProperties.environment[?name==`KEY`].value | [0]' --output text 2>/dev/null || true)
  [ -n "$KEY" ] && [ "$KEY" != None ] || { echo "KEY (the service-account key, base64) is needed the first time"; exit 1; }
  echo "using the key from the last job definition"
fi

aws batch update-compute-environment --compute-environment "$ENV" --state ENABLED \
  --compute-resources minvCpus=0,maxvCpus=$((N * CORES)) >/dev/null
echo "compute environment $ENV capped at $((N * CORES)) cores"

if [ "$(aws batch describe-job-queues --job-queues "$Q" --query 'length(jobQueues)' --output text)" = 0 ]; then
  aws batch create-job-queue --job-queue-name "$Q" --priority 1 --state ENABLED \
    --compute-environment-order order=1,computeEnvironment="$ENV" >/dev/null
  echo "made job queue $Q"; sleep 15
fi

RUN='echo "$KEY" | base64 -d > /tmp/lab-key.json && git clone --depth 1 https://github.com/KMRRing/Dandan.git /opt/dandan && cd /opt/dandan && LAB_BUCKET=dandan-lab-807207481983 LAB_KEY=/tmp/lab-key.json LAB_FILL=1 LAB_SLOTS='$CORES' LAB_POLL_SEC=30 LAB_MAX_HOURS='$HOURS' node lab/worker.mjs'
PROPS=$(python3 - "$RUN" "$KEY" "$CORES" <<'PY'
import json, sys
run, key, cores = sys.argv[1], sys.argv[2], int(sys.argv[3])
print(json.dumps({
  "image": "public.ecr.aws/docker/library/node:22",
  "command": ["bash", "-c", run],
  "resourceRequirements": [{"type": "VCPU", "value": str(cores)}, {"type": "MEMORY", "value": "16000"}],
  "environment": [{"name": "KEY", "value": key}],
}))
PY
)
DEF=$(aws batch register-job-definition --job-definition-name "$Q" --type container --container-properties "$PROPS" \
  --retry-strategy attempts=5 --timeout attemptDurationSeconds=$(( (HOURS + 1) * 3600 )) --query jobDefinitionArn --output text)
echo "job definition $DEF"

if [ "$N" -ge 2 ]; then ARR="--array-properties size=$N"; else ARR=""; fi
aws batch submit-job --job-name "$Q-$(date +%m%d-%H%M)" --job-queue "$Q" --job-definition "$DEF" $ARR --query jobId --output text | sed 's/^/submitted: /'
echo "workers take a few minutes to start and join the queue; stop them all with STOP=1 (see the top of this script)"
