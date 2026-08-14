#!/usr/bin/env bash
# A1-only catcher (E2 micro already won). hunts VM.Standard.A1.Flex free
# allowance — capped at 2 OCPU / 12 GB since oracle's June 2026 halving.
# 2026-08-12: no capacity-report (extra API call, extra 429 fuel) — launch
# every cycle; 3 of 4 launches ask 1/6 (smaller block lands more often);
# cadence floor 20s keeps real capacity checks high per hour.
export PATH="$HOME/.local/bin:/usr/bin:/bin"
T=ocid1.tenancy.oc1..aaaaaaaag5w56hr5i4ze7tkwmjhnwdal3itikk7sstb3cr6gdau3x4grvifq
AD=MbxU:AP-SINGAPORE-1-AD-1
IMG=$(cat ~/oracle-setup/img.txt 2>/dev/null)
[ -z "$IMG" ] && IMG=$(oci compute image list --compartment-id $T --operating-system "Canonical Ubuntu" --shape VM.Standard.A1.Flex --all --query 'data[?contains("display-name", `Canonical-Ubuntu-24.04-`) && !contains("display-name", `Minimal`)].id' --raw-output | head -1)
SUBNET=$(cat ~/oracle-setup/net.txt 2>/dev/null)
[ -z "$SUBNET" ] && SUBNET=$(oci network subnet list --compartment-id $T --all --query 'data[?"display-name"==`nexstream-public`].id' --raw-output | head -1)
SSHKEY=$(cat ~/.ssh/oracle-vm.pub)
LOG=~/oracle-setup/hunt.log
RESULT_LOG=~/oracle-setup/results.log
SLEEP=20
MIN_SLEEP=20
MAX_SLEEP=40
LAUNCH() {
  local OCPS=$1 GB=$2
  echo "[$(date +%H:%M:%S)] launch attempt $OCPS OCPU / $GB GB @ $AD" >> $LOG
  local OUT
  OUT=$(timeout 60 oci compute instance launch --compartment-id $T \
    --availability-domain "$AD" \
    --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$OCPS,\"memoryInGBs\":$GB}" \
    --subnet-id "$SUBNET" --image-id "$IMG" --display-name nexstream-vm \
    --metadata "{\"ssh_authorized_keys\":\"$SSHKEY\"}" \
    --assign-public-ip true --boot-volume-size-in-gbs 50 \
    --no-retry --query 'data.id' --raw-output 2>&1)
  echo "$OUT" >> $LOG
  if [[ "$OUT" == ocid1.instance.* ]]; then
    echo "SUCCESS $OUT ($OCPS/$GB)" >> $LOG
    echo "SUCCESS $OUT ($OCPS/$GB)" > ~/oracle-setup/SUCCESS.txt
    exit 0
  fi
  local CODE
  CODE=$(echo "$OUT" | grep -o '"status": [0-9]*' | head -1 | grep -o '[0-9]*')
  [ -z "$CODE" ] && CODE=500
  echo "$CODE" >> $RESULT_LOG
}
attempts=0
while true; do
  attempts=$((attempts+1))
  echo "[$(date +%H:%M:%S)] check $attempts (sleep ${SLEEP}s)" >> $LOG
  if [ $((attempts % 4)) -eq 0 ]; then
    LAUNCH 2 12
  else
    LAUNCH 1 6
  fi
  if [ -s "$RESULT_LOG" ]; then
    W=$(tail -20 "$RESULT_LOG")
    N429=$(echo "$W" | grep -c '^429$')
    N=$(echo "$W" | wc -l)
    R=$(( N429 * 100 / N ))
    if [ "$R" -gt 45 ] && [ "$SLEEP" -lt "$MAX_SLEEP" ]; then
      SLEEP=$((SLEEP+3))
      echo "[$(date +%H:%M:%S)] throttle ${R}% -> sleep ${SLEEP}s" >> $LOG
    elif [ "$R" -lt 20 ] && [ "$SLEEP" -gt "$MIN_SLEEP" ]; then
      SLEEP=$((SLEEP-3))
      echo "[$(date +%H:%M:%S)] throttle ${R}% -> sleep ${SLEEP}s" >> $LOG
    fi
  fi
  sleep $((SLEEP + RANDOM % 4))
done
