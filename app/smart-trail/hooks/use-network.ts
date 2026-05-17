import { useEffect, useState } from "react";
import * as Network from "expo-network";

function isStateOnline(state: Network.NetworkState): boolean {
  if (!state.isConnected) return false;
  
  if (state.isInternetReachable === false) return false;
  return true;
}

export function useNetwork() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    Network.getNetworkStateAsync().then((state) => {
      if (!cancelled) setIsOnline(isStateOnline(state));
    });

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
