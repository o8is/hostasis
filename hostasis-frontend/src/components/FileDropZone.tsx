import React, { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';

interface FileDropZoneProps {
  onFilesDropped: (files: File[], totalSize: number) => void;
  disabled?: boolean;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({ onFilesDropped, disabled = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Extract files from a zip archive
  const extractZipFile = async (zipFile: File): Promise<File[]> => {
    const zip = new JSZip();
    const contents = await zip.loadAsync(zipFile);
    const extractedFiles: File[] = [];

    // Get all file paths
    const filePaths = Object.keys(contents.files).filter(path => !contents.files[path].dir);

    // Find common prefix (folder name) to strip it
    let commonPrefix = '';
    if (filePaths.length > 0) {
      const firstPath = filePaths[0];
      const firstSlash = firstPath.indexOf('/');
      if (firstSlash > 0) {
        const potentialPrefix = firstPath.substring(0, firstSlash + 1);
        const allHavePrefix = filePaths.every(p => p.startsWith(potentialPrefix));
        if (allHavePrefix) {
          commonPrefix = potentialPrefix;
        }
      }
    }

    for (const path of filePaths) {
      const zipEntry = contents.files[path];

      // Skip macOS metadata files
      if (path.includes('__MACOSX') || path.includes('.DS_Store')) {
        continue;
      }

      const blob = await zipEntry.async('blob');
      // Strip common prefix and create file with relative path
      const relativePath = commonPrefix ? path.replace(commonPrefix, '') : path;
      const file = new File([blob], relativePath, {
        type: blob.type || 'application/octet-stream',
      });
      extractedFiles.push(file);
    }

    return extractedFiles;
  };

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);

    // Check for zip files
    const zipFiles = filesArray.filter(f => f.name.endsWith('.zip'));

    // Handle tar/gz/rar/7z - we can't extract these client-side easily
    const unsupportedArchives = filesArray.filter(f =>
      f.name.endsWith('.tar') || f.name.endsWith('.gz') ||
      f.name.endsWith('.rar') || f.name.endsWith('.7z')
    );

    if (unsupportedArchives.length > 0) {
      alert('.tar, .gz, .rar, and .7z files are not supported. Please use .zip or extract your files first.');
      return;
    }

    // If we have zip files, extract them
    if (zipFiles.length > 0) {
      setIsExtracting(true);
      try {
        const extractedFilesArrays = await Promise.all(zipFiles.map(extractZipFile));
        const extractedFiles = extractedFilesArrays.flat();

        // Combine with non-zip files
        const nonZipFiles = filesArray.filter(f => !f.name.endsWith('.zip'));
        const allFiles = [...nonZipFiles, ...extractedFiles];

        if (allFiles.length === 0) {
          alert('No valid files found in the zip. Please ensure your zip contains web files.');
          setIsExtracting(false);
          return;
        }

        const size = allFiles.reduce((acc, file) => acc + file.size, 0);
        setFiles(allFiles);
        setTotalSize(size);
        onFilesDropped(allFiles, size);
      } catch (err) {
        console.error('Failed to extract zip:', err);
        alert('Failed to extract zip file. Please try again or extract manually.');
      }
      setIsExtracting(false);
      return;
    }

    // No zip files, proceed normally
    if (filesArray.length === 0) {
      alert('No valid files found. Please upload HTML, CSS, JS, and other web files.');
      return;
    }

    const size = filesArray.reduce((acc, file) => acc + file.size, 0);
    setFiles(filesArray);
    setTotalSize(size);
    onFilesDropped(filesArray, size);
  }, [onFilesDropped]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const getAllFilesFromDataTransfer = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const files: File[] = [];
    const items = Array.from(dataTransfer.items);

    const readDirectory = async (entry: FileSystemDirectoryEntry, path: string = ''): Promise<File[]> => {
      const dirFiles: File[] = [];
      const reader = entry.createReader();

      const readEntries = (): Promise<FileSystemEntry[]> => {
        return new Promise((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
      };

      let entries: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await readEntries();
        entries = entries.concat(batch);
      } while (batch.length > 0);

      for (const childEntry of entries) {
        const fullPath = path + childEntry.name;
        
        if (childEntry.isFile) {
          const file = await new Promise<File>((resolve, reject) => {
            (childEntry as FileSystemFileEntry).file(resolve, reject);
          });
          
          // Create a new File with the full path stored in webkitRelativePath
          const fileWithPath = new File([file], file.name, {
            type: file.type,
            lastModified: file.lastModified
          });
          // Store the full path (TypeScript doesn't know about this property but browsers support it)
          Object.defineProperty(fileWithPath, 'webkitRelativePath', {
            value: fullPath,
            writable: false
          });
          
          dirFiles.push(fileWithPath);
        } else if (childEntry.isDirectory) {
          const subFiles = await readDirectory(childEntry as FileSystemDirectoryEntry, fullPath + '/');
          dirFiles.push(...subFiles);
        }
      }

      return dirFiles;
    };

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          if (entry.isFile) {
            const file = item.getAsFile();
            if (file) files.push(file);
          } else if (entry.isDirectory) {
            const dirFiles = await readDirectory(entry as FileSystemDirectoryEntry, entry.name + '/');
            files.push(...dirFiles);
          }
        } else {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }

    return files;
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (disabled) return;

    const allFiles = await getAllFilesFromDataTransfer(e.dataTransfer);
    if (allFiles.length > 0) {
      processFiles(allFiles);
    }
  }, [disabled, processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  }, [processFiles]);

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleBrowseFolderClick = () => {
    folderInputRef.current?.click();
  };

  const clearFiles = () => {
    setFiles([]);
    setTotalSize(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  if (isExtracting) {
    return (
      <div className="file-drop-zone extracting">
        <div className="drop-zone-content">
          <div className="drop-zone-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="spin">
              <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10" />
            </svg>
          </div>
          <div className="drop-zone-text">
            <p className="drop-zone-title">Extracting zip file...</p>
            <p className="drop-zone-subtitle">Please wait while we extract your files.</p>
          </div>
        </div>
      </div>
    );
  }

  if (files.length > 0) {
    return (
      <div className="file-drop-zone-result">
        <div className="file-drop-summary">
          <div className="file-count">{files.length} file{files.length !== 1 ? 's' : ''}</div>
          <div className="file-total-size">{formatFileSize(totalSize)}</div>
        </div>
        <div className="file-list">
          {files.slice(0, 10).map((file, index) => (
            <div key={index} className="file-item">
              <span className="file-name">{file.name}</span>
              <span className="file-size">{formatFileSize(file.size)}</span>
            </div>
          ))}
          {files.length > 10 && (
            <div className="file-item more">
              ...and {files.length - 10} more files
            </div>
          )}
        </div>
        <button onClick={clearFiles} className="clear-files-button">
          Clear and start over
        </button>
      </div>
    );
  }

  return (
    <div
      className={`file-drop-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        multiple
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFileSelect}
        {...{ webkitdirectory: '', directory: '' } as any}
        style={{ display: 'none' }}
      />

      <div className="drop-zone-content">
        <div className="drop-zone-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </div>
        <div className="drop-zone-text">
          <p className="drop-zone-title">
            Drag and drop your project folder here.
          </p>
          <p className="drop-zone-subtitle">
            <button type="button" onClick={handleBrowseFolderClick} className="browse-link">browse to upload a folder</button> or <button type="button" onClick={handleBrowseClick} className="browse-link">upload files</button>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FileDropZone;
