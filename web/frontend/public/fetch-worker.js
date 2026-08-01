// opfs stream downloader
// bypass main thread

self.onmessage = async e => {
  const { url, storageName } = e.data;

  let accessHandle = null;
  let filename = null;
  let totalReceived = 0;
  let contentLength = 0;

  try {
    // setup opfs storage
    if (storageName && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      const processingDir = await root.getDirectoryHandle(
        'phantom-processing',
        { create: true }
      );
      filename = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}-${storageName}`;
      const handle = await processingDir.getFileHandle(filename, {
        create: true
      });

      if (handle.createSyncAccessHandle) {
        accessHandle = await handle.createSyncAccessHandle();
      }
    }

    const fetchStream = async (startByte = 0) => {
      if (!url) throw new Error('Fetch Error: URL is missing.');

      const headers = {};
      if (url?.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
      if (startByte > 0) headers.Range = `bytes=${startByte}-`;

      const response = await fetch(url, {
        headers,
        mode: 'cors',
        credentials: 'omit',
        priority: 'high'
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(
          `Server returned ${response.status} ${response.statusText}`
        );
      }

      if (startByte === 0) {
        contentLength = +response.headers.get('Content-Length') || 0;
        self.postMessage({ type: 'start', contentLength });
      }

      const reader = response.body.getReader();
      const BUFFER_SIZE = 1024 * 512; // 512KB for smoother updates
      const buffer = new Uint8Array(BUFFER_SIZE);
      let offset = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          let pos = 0;
          while (pos < value.length) {
            const take = Math.min(value.length - pos, BUFFER_SIZE - offset);
            buffer.set(value.subarray(pos, pos + take), offset);

            const writeOffset = totalReceived;
            offset += take;
            pos += take;
            totalReceived += take;

            if (offset === BUFFER_SIZE) {
              if (accessHandle) {
                accessHandle.write(buffer, {
                  at: writeOffset - (BUFFER_SIZE - take)
                });
              } else {
                const chunkToSend = buffer.slice();
                self.postMessage(
                  {
                    type: 'chunk',
                    chunk: chunkToSend,
                    received: totalReceived
                  },
                  [chunkToSend.buffer]
                );
              }
              offset = 0;
            }
          }
          // report progress
          self.postMessage({ type: 'progress', received: totalReceived });
        }

        if (done) {
          if (offset > 0) {
            const finalChunk = buffer.slice(0, offset);
            if (accessHandle) {
              accessHandle.write(finalChunk, { at: totalReceived - offset });
            } else {
              self.postMessage(
                { type: 'chunk', chunk: finalChunk, received: totalReceived },
                [finalChunk.buffer]
              );
            }
          }
          break;
        }
      }
    };

    // retry loop
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      try {
        await fetchStream(totalReceived);
        break; // success
      } catch (err) {
        attempts++;
        console.warn(
          `[FetchWorker] Stream interrupted at ${totalReceived} bytes. Retry ${attempts}/${maxAttempts}...`,
          err.message
        );
        if (attempts === maxAttempts) throw err;
        // skipcq: JS-0073
        await new Promise(r => setTimeout(r, 1000 * attempts));
      }
    }

    if (accessHandle) {
      await accessHandle.flush();
      await accessHandle.close();

      if (contentLength > 0 && totalReceived < contentLength) {
        throw new Error(
          `Incomplete download: got ${totalReceived}/${contentLength} bytes.`
        );
      }

      self.postMessage({ type: 'done', filename });
    } else {
      self.postMessage({ type: 'done' });
    }
  } catch (err) {
    if (accessHandle)
      try {
        await accessHandle.close();
      } catch (_e) {
        // empty
      }
    self.postMessage({ type: 'error', message: err.message });
  }
};
