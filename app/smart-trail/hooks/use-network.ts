import { useEffect, useState } from "react";
import * as Network from "expo-network";

function isStateOnline(state: Network.NetworkState): boolean {
  if (!state.isConnected) return false;
  // isInternetReachable is null when undetermined (common on Android) — treat as online
  if (state.isInternetReachable === false) return false;
  return true;
}

export function useNetwork() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Initial check
    Network.getNetworkStateAsync().then((state) => {
      if (!cancelled) setIsOnline(isStateOnline(state));
    });

    // Real-time listener — fires immediately on connectivity change
    const sub = Network.addNetworkStateListener((state) => {
      if (!cancelled) setIsOnline(isStateOnline(state));
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return { isOnline };
}
