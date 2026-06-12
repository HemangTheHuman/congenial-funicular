# Phase 10 Reference: UX Polish, Speed Enhancements & Bug Fixes

This document outlines the changes made to improve transcriber speed, reduce visual clutter, and fix image rendering issues across the various workspace clients (Labeler, Reviewer, and Correction). These improvements correspond to Phase 13 of the project plan.

---

## 1. UX and Speed Improvements

To maximize the efficiency of reviewers and labelers working with large batches of data, several zero-latency tools and shortcuts were introduced:

- **Keyboard Shortcuts (Reviewer):** Implemented hotkeys for the most common actions to allow mouse-free processing:
  - `A`: Approve
  - `R`: Reject Text
  - `S`: Reject Script
  - `U`: Toggle Unreadable (across all workspaces)
- **Full Page Zoom Controls:** Added zoom-in/zoom-out controls (scaling from 20% to 500%) on the full-page image preview, enabling deep inspection of dense manuscript scans.
- **Instant Image Adjustments (Crop View):** Added real-time controls for brightness, contrast, and color inversion. By utilizing the CSS `filter` property on the `<img>` tags (`filter: brightness(...) contrast(...) invert(...)`), the image updates instantly without requiring server round-trips or canvas re-rendering.

---

## 2. Visual Enhancements & Clutter Reduction

In the earlier phases, the full-page image overlay drew bounding boxes and numeric index labels for *all* regions on the page simultaneously. For pages with dense text (e.g., 50+ lines), this resulted in extreme visual clutter that made it difficult to read the surrounding context.

- **Active-Only Highlighting:** The `WorkspaceClient`, `ReviewWorkspaceClient`, and `CorrectionWorkspaceClient` were refactored to remove the `allRegions.map` render loop.
- **Behavior:** The full-page overlay now renders only a single highlighted bounding box for the specific region currently focused by the user. Numeric index badges were entirely removed from the overlay.

---

## 3. Bug Fixes: Image Fetching and Rotation Alignment

Two critical issues preventing images from loading or aligning properly were identified and fixed:

### 3.1. Azure Blob Storage Signature (`403 Forbidden`)
- **Issue:** Images containing spaces or parentheses in their filenames (e.g., `Mohsinpur (PATNA)-page-214.jpg`) failed to load via the Next.js `image-proxy` API due to Azure `403 AuthenticationFailed` errors.
- **Root Cause:** The Azure `SharedKey` HMAC-SHA256 signature was being computed on the raw, unencoded string path. However, when making the HTTP request, Node's `fetch` automatically url-encoded the spaces. Azure expects the `CanonicalizedResource` string used for signing to match the exact URL-encoded path submitted in the HTTP request.
- **Fix:** Refactored `utils/azureBlob.ts` to strictly apply `encodeURIComponent` to each segment of the `blobPath` before generating both the `CanonicalizedResource` string and the final `blobUrl`.

### 3.2. Label Studio Rotated Region Alignment
- **Issue:** For text lines that were skewed or diagonal, Label Studio outputs a rotated bounding box. In the crop preview, these regions were misaligned, and in the full-page view, the highlight box was drawn in the wrong location.
- **Root Cause:** Label Studio applies rotation using the **top-left corner** (`x, y`) of the region as the anchor point. Our CSS was incorrectly assuming a `center` anchor point (`transformOrigin: 'center'`). Furthermore, the crop preview was rotating the image in the positive direction rather than counter-rotating it.
- **Fix:**
  - **Full Page View:** Updated CSS to `transformOrigin: 'top left'`.
  - **Crop Preview:** Updated `transform` to apply a negative angle (`rotate(${-region.rotation}deg)`) and anchored it strictly to the top-left coordinate (`transformOrigin: ${originX}px ${originY}px`). This guarantees that diagonal text is counter-rotated to appear completely horizontal and upright for the transcriber.
