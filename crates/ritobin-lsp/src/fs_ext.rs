//! Filesystem helpers.

use std::{ffi::OsString, fs, io, path::Path};

/// Suffix of the temporary sibling file used by [`write_atomic`].
const TMP_SUFFIX: &str = ".tmp-ritobin";

/// Writes `contents` to `path` atomically: the data goes to a temporary
/// sibling file first, which is then renamed over the target, so an
/// interrupted write never leaves a half-written `path` behind. The
/// temporary file is cleaned up if the rename fails.
pub fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut tmp = OsString::from(path.as_os_str());
    tmp.push(TMP_SUFFIX);
    let tmp = Path::new(&tmp);

    fs::write(tmp, contents)?;
    fs::rename(tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_file_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join("ritobin-lsp-tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{}-write-atomic.bin", std::process::id()));
        fs::write(&path, b"old").unwrap();

        write_atomic(&path, b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
        let mut tmp = OsString::from(path.as_os_str());
        tmp.push(TMP_SUFFIX);
        assert!(!Path::new(&tmp).exists());
        let _ = fs::remove_file(&path);
    }
}
