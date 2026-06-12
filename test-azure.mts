import { fetchAzureBlob, decodeLsResolveUrl, extractBlobUri, parseAzureBlobUri } from './utils/azureBlob.js';

const rawUrl = "https://multilipi-label-studio.centralindia.cloudapp.azure.com/tasks/3425/resolve/?fileuri=YXp1cmUtYmxvYjovL2thaXRoaS9kYXRhL3BhZ2VzL01vaHNpbnB1ciAoUEFUTkEpLXBhZ2UtMjE0LmpwZw==";

const blobUri = extractBlobUri(rawUrl);
console.log("Blob URI:", blobUri);

if (blobUri) {
  const parsed = parseAzureBlobUri(blobUri);
  console.log("Parsed:", parsed);
  if (parsed) {
    try {
      // Modify parse object to have encoded blobPath
      parsed.blobPath = parsed.blobPath.split('/').map(encodeURIComponent).join('/');
      console.log("Encoded blobPath:", parsed.blobPath);
      const res = await fetchAzureBlob(parsed.container, parsed.blobPath);
      console.log("Status:", res.status);
      console.log("Headers:", Object.fromEntries(res.headers.entries()));
      const text = await res.text();
      console.log("Body:", text);
    } catch (err) {
      console.error(err);
    }
  }
}
