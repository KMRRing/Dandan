"""The GPU machines' Kubernetes setup, made from the lab's own (26 Nov 2026, Fable 16:20Z after the director's review).

Run by .github/workflows/k8s-apply.yml on the GitHub runner, never by hand: it reads the lab setup (the LAB_K8S_MANIFEST secret,
which holds the store key) and writes the GPU cluster's setup, so the key never leaves the runner:
  - every object of the lab setup but its CPU DaemonSet (dandan-lab), unchanged: whatever holds the store's credentials;
  - one Deployment, dandan-gpu: one pod asking for one GPU (nvidia.com/gpu: 1), on the PyTorch CUDA image with node added, its
    container's environment, mounts and volumes those of the CPU worker, and its start-up the CPU worker's with
    lab/gpu-runner.mjs in place of lab/worker.mjs.
Prints only the objects' kinds and names, the names of the environment variables and the mount paths, never a value.
usage: python3 lab/k8s/gpu-setup.py <lab setup.yaml> <out.yaml> <cluster name>"""
import sys, yaml

IMAGE = "mirror.gcr.io/pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime"
NODE = "v22.11.0"
# the PyTorch image is Ubuntu with Python and CUDA's libraries but no node or git: both added before the worker's own start-up
PRELUDE = f"""set -e
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl xz-utils ca-certificates >/dev/null; fi
if ! command -v node >/dev/null; then curl -fsSL https://nodejs.org/dist/{NODE}/node-{NODE}-linux-x64.tar.xz | tar -xJ -C /opt && ln -sf /opt/node-{NODE}-linux-x64/bin/node /usr/local/bin/node; fi
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || echo "no nvidia-smi in the pod: the node has no NVIDIA container runtime"
"""

src, out, cluster = sys.argv[1:4]
docs = [d for d in yaml.safe_load_all(open(src)) if d]
ds = [d for d in docs if d.get("kind") == "DaemonSet" and d["metadata"]["name"] == "dandan-lab"]
if len(ds) != 1: sys.exit("gpu-setup: the lab setup has no single DaemonSet dandan-lab; nothing written")
ds = ds[0]
pod = ds["spec"]["template"]["spec"]
c = pod["containers"][0]
cmd = (c.get("command") or []) + (c.get("args") or [])
# the start-up must be a shell script (sh -c / bash -c '<script>') that runs lab/worker.mjs
if len(cmd) < 3 or cmd[0].split("/")[-1] not in ("sh", "bash") or cmd[-2] not in ("-c", "-lc", "-ec") or "worker.mjs" not in cmd[-1]:
    sys.exit(f"gpu-setup: the CPU worker's start-up isn't a shell script running lab/worker.mjs ({len(cmd)} words); nothing written")
script = PRELUDE + cmd[-1].replace("lab/worker.mjs", "lab/gpu-runner.mjs").replace(" worker.mjs", " lab/gpu-runner.mjs")

gc = {k: v for k, v in c.items() if k in ("env", "envFrom", "volumeMounts", "workingDir")}
gc["env"] = [e for e in gc.get("env", []) if e.get("name") != "LAB_POOL"] + [{"name": "LAB_POOL", "value": cluster}, {"name": "LAB_GPU_SLOTS", "value": "1"}]
gc.update({"name": "gpu-runner", "image": IMAGE, "command": [cmd[0], cmd[-2], script],
           "resources": {"limits": {"nvidia.com/gpu": 1}, "requests": {"nvidia.com/gpu": 1, "cpu": "4", "memory": "16Gi"}}})
gpod = {k: v for k, v in pod.items() if k in ("volumes", "imagePullSecrets", "serviceAccountName", "securityContext", "dnsPolicy")}
gpod.update({"containers": [gc], "terminationGracePeriodSeconds": 60,
             "tolerations": (pod.get("tolerations") or []) + [{"key": "nvidia.com/gpu", "operator": "Exists", "effect": "NoSchedule"}]})
meta = {"name": "dandan-gpu", "labels": {"app": "dandan-gpu"}}
if ds["metadata"].get("namespace"): meta["namespace"] = ds["metadata"]["namespace"]
dep = {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": meta,
       "spec": {"replicas": 1, "strategy": {"type": "Recreate"}, "selector": {"matchLabels": {"app": "dandan-gpu"}},
                "template": {"metadata": {"labels": {"app": "dandan-gpu"}}, "spec": gpod}}}
keep = [d for d in docs if d is not ds]
with open(out, "w") as f: yaml.safe_dump_all(keep + [dep], f, sort_keys=False)
print("gpu-setup:", ", ".join(f"{d['kind']}/{d['metadata']['name']}" for d in keep + [dep]))
print("  environment:", ", ".join(e["name"] for e in gc.get("env", [])) or "none", "| from:", len(gc.get("envFrom", [])), "source(s)",
      "| mounts:", ", ".join(m["mountPath"] for m in gc.get("volumeMounts", [])) or "none")
