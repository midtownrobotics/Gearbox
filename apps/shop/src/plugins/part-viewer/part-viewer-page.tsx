import { Button, Card, ErrorBanner, Field, Loading, Page, SuccessBanner, inputClass } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface ErrorState {
  error: string;
  details: string;
}

export function PartViewerPage() {
  const { partNumber } = useParams<{ partNumber: string }>();
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const checkDrawing = useCallback(async () => {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";
      const url = `${apiBase}/parts/${partNumber}/drawing`;

      const response = await fetch(url, {
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as ErrorState;
        setErrorState(errorData);
        return;
      }

      setPdfUrl(url);
      setErrorState(null);
    } catch (err) {
      setErrorState({
        error: "Failed to check drawing",
        details:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while checking the drawing.",
      });
    }
  }, [partNumber]);

  useEffect(() => {
    if (!partNumber) return;

    setLoading(true);
    checkDrawing().finally(() => setLoading(false));
  }, [partNumber, checkDrawing]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !partNumber) {
      setUploadMessage({ type: "error", text: "Missing file or part number" });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("partNumber", partNumber);
      formData.append("uploadedBy", "part-viewer");

      const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";
      const res = await fetch(`${apiBase}/drawings/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = (await res.json()) as { error?: string; filename?: string };
      if (!res.ok) {
        setUploadMessage({ type: "error", text: data.error || "Upload failed" });
      } else {
        setUploadMessage({ type: "success", text: `Uploaded: ${data.filename}` });
        setUploadFile(null);
        setShowUploadForm(false);
        if (e.target instanceof HTMLFormElement) {
          e.target.reset();
        }
        // Refresh the drawing
        await checkDrawing();
        // Force PDF refresh by incrementing key
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setUploadMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  };

  if (!partNumber || loading) {
    return (
      <Page title="Drawing" width="narrow">
        {partNumber ? <Loading /> : <ErrorBanner message="No part number in the address." />}
      </Page>
    );
  }

  const partLine = <span className="font-mono">{partNumber}</span>;

  if (showUploadForm) {
    return (
      <Page title="Drawing" description={partLine} width="narrow">
        <Card title="Upload a drawing">
          <form onSubmit={handleUpload} className="space-y-4">
            <Field
              label="PDF file"
              hint={
                uploadFile ? `Selected: ${uploadFile.name}` : "It replaces the drawing saved now."
              }
            >
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className={inputClass}
                disabled={uploading}
              />
            </Field>
            {uploadMessage &&
              (uploadMessage.type === "success" ? (
                <SuccessBanner message={uploadMessage.text} />
              ) : (
                <ErrorBanner message={uploadMessage.text} />
              ))}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!uploadFile || uploading}>
                {uploading ? "Uploading…" : "Upload"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowUploadForm(false);
                  setUploadFile(null);
                  setUploadMessage(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </Page>
    );
  }

  if (!pdfUrl) {
    return (
      <Page title="Drawing" description={partLine} width="narrow">
        {errorState && (
          <Card className="space-y-3">
            <h2 className="font-sans text-lg font-semibold text-secondary-900">
              {errorState.error}
            </h2>
            <p className="text-sm text-secondary-600">{errorState.details}</p>
            {errorState.error === "Drawing not available" && (
              <Button onClick={() => setShowUploadForm(true)}>Upload a drawing</Button>
            )}
          </Card>
        )}
      </Page>
    );
  }

  return (
    <Page
      title="Drawing"
      description={partLine}
      width="full"
      actions={
        <Button variant="secondary" onClick={() => setShowUploadForm(true)}>
          Replace drawing
        </Button>
      }
    >
      <embed
        key={refreshKey}
        src={`${pdfUrl}?v=${refreshKey}`}
        type="application/pdf"
        className="h-[calc(100dvh-14rem)] min-h-96 w-full rounded-xl border border-secondary-200 bg-surface"
        title={`Drawing for ${partNumber}`}
      />
    </Page>
  );
}
