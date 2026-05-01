import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

const ScreenshotManager = ({
  label = 'Screenshots',
  existingScreenshots = [],
  pendingFiles = [],
  error = '',
  onFilesSelected,
  onRemoveExisting,
  onRemovePending,
  inputId = 'screenshot-upload'
}) => {
  const [pendingPreviewUrls, setPendingPreviewUrls] = useState([]);

  useEffect(() => {
    if (!pendingFiles.length) {
      setPendingPreviewUrls([]);
      return undefined;
    }

    const urls = pendingFiles.map((file) => window.URL.createObjectURL(file));
    setPendingPreviewUrls(urls);
    return () => {
      urls.forEach((url) => window.URL.revokeObjectURL(url));
    };
  }, [pendingFiles]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <label htmlFor={inputId} className="btn-muted cursor-pointer px-3 py-1.5 text-xs">
          Add screenshots
        </label>
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={onFilesSelected}
      />
      <p className="text-xs text-slate-600 dark:text-slate-400">PNG/JPG/WebP up to 5MB each</p>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {!!existingScreenshots.length && (
        <div className="grid gap-3 md:grid-cols-2">
          {existingScreenshots.map((item, index) => (
            <div key={item.key || item.url || index} className="space-y-2 rounded-md border border-slate-300 p-2 dark:border-slate-700">
              <img
                src={item.url}
                alt={`Screenshot ${index + 1}`}
                className="max-h-56 w-full rounded object-contain"
              />
              <div className="flex gap-2">
                <a href={item.url} target="_blank" rel="noreferrer" className="btn-muted px-2 py-1 text-xs">
                  Open
                </a>
                <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => onRemoveExisting(index)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!!pendingFiles.length && (
        <div className="grid gap-3 md:grid-cols-2">
          {pendingFiles.map((file, index) => (
            <div key={`${file.name}-${file.size}-${index}`} className="space-y-2 rounded-md border border-dashed border-sky-300 p-2 dark:border-sky-700">
              {pendingPreviewUrls[index] ? (
                <img
                  src={pendingPreviewUrls[index]}
                  alt={`Pending screenshot ${index + 1}`}
                  className="max-h-56 w-full rounded object-contain"
                />
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-slate-600 dark:text-slate-300">{file.name}</p>
                <button type="button" className="btn-muted px-2 py-1 text-xs" onClick={() => onRemovePending(index)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

ScreenshotManager.propTypes = {
  label: PropTypes.string,
  existingScreenshots: PropTypes.arrayOf(
    PropTypes.shape({
      url: PropTypes.string,
      key: PropTypes.string
    })
  ),
  pendingFiles: PropTypes.arrayOf(PropTypes.object),
  error: PropTypes.string,
  onFilesSelected: PropTypes.func.isRequired,
  onRemoveExisting: PropTypes.func.isRequired,
  onRemovePending: PropTypes.func.isRequired,
  inputId: PropTypes.string
};

ScreenshotManager.defaultProps = {
  label: 'Screenshots',
  existingScreenshots: [],
  pendingFiles: [],
  error: '',
  inputId: 'screenshot-upload'
};

export default ScreenshotManager;
