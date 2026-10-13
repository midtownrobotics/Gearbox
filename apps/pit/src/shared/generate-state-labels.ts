import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";

type Battery = {
  id: number;
  name: string;
};

type StateLabel = {
  code: string;
  label: string;
};

const STATE_LABELS: StateLabel[] = [
  { code: "ST-IDLE", label: "Idle" },
  { code: "ST-CHAR", label: "Charging" },
  { code: "ST-NXUP", label: "Next Up" },
  { code: "ST-BRKN", label: "Broken" },
  { code: "ST-ROBT", label: "In Robot" },
];

export async function generateBatteryAndStatesPDF(
  batteries: Battery[],
  selectedStates: string[],
): Promise<void> {
  if (batteries.length === 0 && selectedStates.length === 0) {
    throw new Error("Choose at least one battery or state.");
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 10;
  const barcodeWidth = 40;
  const barcodeHeight = 25;
  const labelHeight = 8;
  const spacing = 5;
  const itemHeight = barcodeHeight + labelHeight + spacing;
  const itemsPerRow = Math.floor((pageWidth - margin * 2) / (barcodeWidth + spacing));

  let itemIndex = 0;
  let x = margin;
  let y = margin;

  // Generate battery barcodes
  for (const battery of batteries) {
    if (y + itemHeight > pageHeight - margin) {
      pdf.addPage();
      x = margin;
      y = margin;
    }

    const barcodeValue = `BAT-${String(battery.id).padStart(4, "0")}`;
    const canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, barcodeValue, {
        format: "CODE128",
        width: 2,
        height: 37,
        displayValue: false,
      });

      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", x, y, barcodeWidth, barcodeHeight);

      pdf.setFontSize(10);
      pdf.text(battery.name, x + barcodeWidth / 2, y + barcodeHeight + 2, {
        align: "center",
      });
    } catch (err) {
      console.error(`Failed to generate barcode for battery ${battery.id}:`, err);
    }

    itemIndex++;
    x += barcodeWidth + spacing;
    if (itemIndex % itemsPerRow === 0) {
      x = margin;
      y += itemHeight;
    }
  }

  // Generate state labels (1 copy each)
  for (const stateCode of selectedStates) {
    const stateLabel = STATE_LABELS.find((s) => s.code === stateCode);
    if (!stateLabel) continue;

    if (y + itemHeight > pageHeight - margin) {
      pdf.addPage();
      x = margin;
      y = margin;
    }

    const canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, stateLabel.code, {
        format: "CODE128",
        width: 2,
        height: 37,
        displayValue: false,
      });

      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", x, y, barcodeWidth, barcodeHeight);

      pdf.setFontSize(10);
      pdf.text(stateLabel.label, x + barcodeWidth / 2, y + barcodeHeight + 2, {
        align: "center",
      });
    } catch (err) {
      console.error(`Failed to generate label for state ${stateLabel.code}:`, err);
    }

    itemIndex++;
    x += barcodeWidth + spacing;
    if (itemIndex % itemsPerRow === 0) {
      x = margin;
      y += itemHeight;
    }
  }

  const timestamp = new Date().toISOString().split("T")[0];
  pdf.save(`battery-labels-${timestamp}.pdf`);
}
