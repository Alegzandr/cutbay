/**
 * Programmatic media picker: builds a hidden <input type="file">, clicks it and
 * forwards the chosen files. Lets any command (menu bar, mobile tool rail) open
 * the OS file dialog without owning a React ref to an <input> in the DOM.
 */
const ACCEPT =
  'video/*,audio/*,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac,.srt,.vtt';

export function openMediaPicker(onFiles: (files: FileList) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.multiple = true;
  input.style.display = 'none';
  input.addEventListener('change', () => {
    if (input.files?.length) onFiles(input.files);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
