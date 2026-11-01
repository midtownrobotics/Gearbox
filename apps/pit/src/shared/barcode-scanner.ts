// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";

type ScanState = {
  stateCode: string | null;
  batteryCode: string | null;
  scanInProgress: boolean;
};

const STATE_CODES = new Set(["ST-IDLE", "ST-CHAR", "ST-NXUP", "ST-BRKN", "ST-ROBT"]);
const BATTERY_CODE_PATTERN = /^BAT-\d{4}$/;
const TIMEOUT_MS = 6000;

export function useBarcodeScan(onComplete?: (state: string, battery: string) => void) {
  const [scan, setScan] = useState<ScanState>({
    stateCode: null,
    batteryCode: null,
    scanInProgress: false,
  });

  const scanStateRef = useRef<ScanState>(scan);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    scanStateRef.current = scan;
  }, [scan]);

  useEffect(() => {
    let barcodeBuffer = "";
    let lastKeyTime = Date.now();

    const handleKeydown = (event: KeyboardEvent) => {
      const currentTime = Date.now();
      const timeDifference = currentTime - lastKeyTime;
      lastKeyTime = currentTime;

      // Process the completed barcode when "Enter" is detected
      if (event.key === "Enter") {
        // Special case: CANCEL stops the current scan
        if (barcodeBuffer === "CANCEL") {
          console.log("[BarcodeScan] Cancel requested");
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setScan({
            stateCode: null,
            batteryCode: null,
            scanInProgress: false,
          });
          barcodeBuffer = "";
          return;
        }

        if (barcodeBuffer.length >= 7) {
          const currentState = scanStateRef.current;
          const isStateCode = STATE_CODES.has(barcodeBuffer);
          const isBatteryCode = BATTERY_CODE_PATTERN.test(barcodeBuffer);

          if (isStateCode) {
            // Scanned a state code
            if (!currentState.stateCode && !currentState.batteryCode) {
              // First scan - state code
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              console.log(`[BarcodeScan] Setting ${TIMEOUT_MS}ms timeout for state code scan`);
              timeoutRef.current = setTimeout(() => {
                console.log("[BarcodeScan] Timeout fired - resetting scan");
                setScan({
                  stateCode: null,
                  batteryCode: null,
                  scanInProgress: false,
                });
                timeoutRef.current = null;
              }, TIMEOUT_MS);

              setScan({
                stateCode: barcodeBuffer,
                batteryCode: null,
                scanInProgress: true,
              });
            } else if (currentState.stateCode && !currentState.batteryCode) {
              // Override first state code if no battery scanned yet
              setScan({
                stateCode: barcodeBuffer,
                batteryCode: null,
                scanInProgress: true,
              });
            } else if (currentState.batteryCode && !currentState.stateCode) {
              // Second scan type - state code after battery code (complete scan)
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              timeoutRef.current = null;

              onComplete?.(barcodeBuffer, currentState.batteryCode);

              setScan({
                stateCode: barcodeBuffer,
                batteryCode: currentState.batteryCode,
                scanInProgress: false,
              });

              setTimeout(() => {
                setScan({
                  stateCode: null,
                  batteryCode: null,
                  scanInProgress: false,
                });
              }, 500);
            }
          } else if (isBatteryCode) {
            // Scanned a battery code
            if (!currentState.stateCode && !currentState.batteryCode) {
              // First scan - battery code
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              console.log(`[BarcodeScan] Setting ${TIMEOUT_MS}ms timeout for battery code scan`);
              timeoutRef.current = setTimeout(() => {
                console.log("[BarcodeScan] Timeout fired - resetting scan");
                setScan({
                  stateCode: null,
                  batteryCode: null,
                  scanInProgress: false,
                });
                timeoutRef.current = null;
              }, TIMEOUT_MS);

              setScan({
                stateCode: null,
                batteryCode: barcodeBuffer,
                scanInProgress: true,
              });
            } else if (currentState.batteryCode && !currentState.stateCode) {
              // Override first battery code if no state scanned yet
              setScan({
                stateCode: null,
                batteryCode: barcodeBuffer,
                scanInProgress: true,
              });
            } else if (currentState.stateCode && !currentState.batteryCode) {
              // Second scan type - battery code after state code (complete scan)
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              timeoutRef.current = null;

              onComplete?.(currentState.stateCode, barcodeBuffer);

              setScan({
                stateCode: currentState.stateCode,
                batteryCode: barcodeBuffer,
                scanInProgress: false,
              });

              setTimeout(() => {
                setScan({
                  stateCode: null,
                  batteryCode: null,
                  scanInProgress: false,
                });
              }, 500);
            }
          }
        }
        barcodeBuffer = "";
        return;
      }

      // Reset buffer if a human is typing slowly
      if (timeDifference > 50) {
        barcodeBuffer = "";
      }

      // Append valid characters to the buffer
      if (event.key.length === 1) {
        barcodeBuffer += event.key;
      }
    };

    window.addEventListener("keydown", handleKeydown);

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [onComplete]);

  return scan;
}
