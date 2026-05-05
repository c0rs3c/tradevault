import { constants, accessSync } from 'fs';

const DEFAULT_PYTHON_CANDIDATES = [
  '/usr/bin/python3',
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  'python3',
  'python'
];

const isExecutableFile = (filePath) => {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolvePythonBin = () => {
  const configured = String(process.env.MARKET_DATA_PYTHON || '').trim();
  if (configured) return configured;

  const absoluteCandidate = DEFAULT_PYTHON_CANDIDATES.find(
    (candidate) => candidate.startsWith('/') && isExecutableFile(candidate)
  );
  if (absoluteCandidate) return absoluteCandidate;

  return 'python3';
};

