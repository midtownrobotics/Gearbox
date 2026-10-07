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

  if (!partNumber) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-page p-4">
        <div className="bg-surface rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-600 text-4xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Missing Part Number</h1>
          <p className="text-gray-600">
            No part number was provided. Please check the URL and try again.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-page p-4">
        <div className="bg-surface rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="animate-spin text-primary-600 text-4xl mb-4">⏳</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Loading Drawing</h1>
          <p className="text-gray-600">
            Please wait while we retrieve the drawing for part {partNumber}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-surface flex flex-col">
      {pdfUrl && !showUploadForm && (
        <>
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">
              Drawing for Part <span className="font-mono text-primary-600">{partNumber}</span>
            </h1>
            <button
              type="button"
              onClick={() => setShowUploadForm(true)}
              className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 font-medium text-sm"
            >
              Replace Drawing
            </button>
          </div>
          <embed
            key={refreshKey}
            src={`${pdfUrl}?v=${refreshKey}`}
            type="application/pdf"
            className="flex-1 w-full"
            title={`Drawing for ${partNumber}`}
          />
        </>
      )}

      {showUploadForm && (
        <div className="flex items-center justify-center flex-1 p-4">
          <div className="bg-surface rounded-lg shadow-lg p-8 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Upload Drawing</h2>
              <button
                type="button"
                onClick={() => {
                  setShowUploadForm(false);
                  setUploadFile(null);
                  setUploadMessage(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Part:</span>{" "}
                <span className="font-mono text-primary-600">{partNumber}</span>
              </p>
              <p className="text-xs text-gray-600 mt-2">
                Upload a PDF drawing file for this part. This will replace any existing drawing.
              </p>
            </div>
            <form onSubmit={handleUpload} className="space-y-3">
              <div>
                <label htmlFor="pdf-file" className="block text-sm font-medium text-gray-700 mb-1">
                  PDF File
                </label>
                <input
                  id="pdf-file"
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm border border-gray-300 rounded p-2"
                  disabled={uploading}
                />
                {uploadFile && (
                  <p className="text-sm text-gray-600 mt-1">Selected: {uploadFile.name}</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="flex-1 text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:bg-gray-400"
                >
                  {uploading ? "Uploading..." : "Upload"}
                </button>
              </div>

              {uploadMessage && (
                <div
                  className={`text-sm p-2 rounded ${
                    uploadMessage.type === "success"
                      ? "bg-green-100 text-green-800 border border-green-300"
                      : "bg-red-100 text-red-800 border border-red-300"
                  }`}
                >
                  {uploadMessage.text}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {!pdfUrl && !loading && errorState && !showUploadForm && (
        <div className="flex items-center justify-center flex-1 p-4">
          <div className="bg-surface rounded-lg shadow-lg p-8 max-w-md w-full">
            <div className="text-red-600 text-5xl mb-4 text-center">📋</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{errorState.error}</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">{errorState.details}</p>
            {errorState.error === "Drawing not available" && (
              <button
                type="button"
                onClick={() => setShowUploadForm(true)}
                className="w-full bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 font-medium mb-4"
              >
                Upload a Drawing
              </button>
            )}
            <p className="text-xs text-gray-500 text-center">
              Part: <span className="font-mono font-bold">{partNumber}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
