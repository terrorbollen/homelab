#!/bin/bash
# Script to adopt existing PV and PVC into Helm management

RELEASE_NAME="media"
NAMESPACE="media"
PV_NAME="media-ssd"
PVC_NAME="media-ssd"

echo "Adding Helm ownership labels to PV $PV_NAME..."
kubectl label pv $PV_NAME app.kubernetes.io/managed-by=Helm --overwrite
kubectl annotate pv $PV_NAME meta.helm.sh/release-name=$RELEASE_NAME meta.helm.sh/release-namespace=$NAMESPACE --overwrite

echo "Adding Helm ownership labels to PVC $PVC_NAME in namespace $NAMESPACE..."
kubectl label pvc $PVC_NAME -n $NAMESPACE app.kubernetes.io/managed-by=Helm --overwrite
kubectl annotate pvc $PVC_NAME -n $NAMESPACE meta.helm.sh/release-name=$RELEASE_NAME meta.helm.sh/release-namespace=$NAMESPACE --overwrite

echo "Done! Your PV and PVC should now be adoptable by Helm."
