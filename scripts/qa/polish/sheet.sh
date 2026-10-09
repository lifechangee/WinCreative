#!/bin/bash
# usage: sheet.sh out.png cols in1 in2 ...
out=$1; cols=$2; shift 2
args=(); n=0; filt=""
for f in "$@"; do args+=(-i "$f"); filt+="[$n:v]scale=800:-1[s$n];"; n=$((n+1)); done
ins=""; for ((i=0;i<n;i++)); do ins+="[s$i]"; done
rows=$(( (n+cols-1)/cols ))
ffmpeg -y -v error "${args[@]}" -filter_complex "${filt}${ins}xstack=inputs=$n:layout=$(for ((i=0;i<n;i++)); do echo -n "$(( (i%cols)*800 ))_$(( (i/cols)*450 ))|"; done | sed 's/|$//')" "$out"
