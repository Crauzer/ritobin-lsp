//! Conversion between League `.bin` files and ritobin text, backing the
//! `ritobin-lsp/deserializeBin` / `ritobin-lsp/serializeBin` requests.
//!
//! Both functions do blocking file IO and are meant to run inside
//! `tokio::task::spawn_blocking`. Errors are user-facing strings that the
//! dispatcher forwards as LSP response errors.

use std::{
    fs,
    io::{BufReader, Cursor, Read as _},
    path::Path,
};

use ltk_ritobin::{Cst, print::Print as _, typecheck::visitor::Diagnostic};

use crate::{fs_ext, lsp::ext::DeserializeBinResult};

pub fn deserialize_bin(bin_path: &Path) -> Result<DeserializeBinResult, String> {
    let file = fs::File::open(bin_path)
        .map_err(|e| format!("Failed to open '{}': {e}", bin_path.display()))?;
    let bin = ltk_meta::Bin::from_reader(&mut BufReader::new(file)).map_err(|e| match e {
        ltk_meta::Error::InvalidFileSignature => format!(
            "'{}' is not a League of Legends .bin file.",
            bin_path.display()
        ),
        e => format!("Failed to read '{}': {e}", bin_path.display()),
    })?;

    // Default print config renders all hashes as hex; hashtable-backed naming
    // can be layered in later via a PrintConfig hash provider.
    let text = bin
        .print()
        .map_err(|e| format!("Failed to print '{}' as ritobin: {e}", bin_path.display()))?;

    Ok(DeserializeBinResult {
        text,
        is_override: bin.is_override,
    })
}

pub fn serialize_bin(bin_path: &Path, text: &str) -> Result<(), String> {
    // Bin::to_writer panics (todo!()) on override bins - never let a PTCH
    // target through, even if the client-side readonly guard failed.
    if is_ptch_file(bin_path) {
        return Err(format!(
            "'{}' is a PTCH override bin, which cannot be written back yet.",
            bin_path.display()
        ));
    }

    let cst = Cst::parse(text);
    if let Some(first) = cst.errors.first() {
        let (line, col) = line_col(text, first.span.start);
        return Err(format!(
            "Cannot save: {} parse error(s), first at line {line}, column {col}. Fix the errors shown in the editor and try again.",
            cst.errors.len()
        ));
    }

    let (bin, diagnostics) = cst.build_bin(text);
    let errors: Vec<_> = diagnostics
        .iter()
        .filter(|d| !matches!(d.diagnostic, Diagnostic::ShadowedEntry { .. }))
        .collect();
    if let Some(first) = errors.first() {
        let (line, col) = line_col(text, first.span.start);
        return Err(format!(
            "Cannot save: {} error(s), first at line {line}, column {col}. Fix the diagnostics shown in the editor and try again.",
            errors.len()
        ));
    }

    let mut buf = Cursor::new(Vec::new());
    bin.to_writer(&mut buf)
        .map_err(|e| format!("Failed to serialize bin: {e}"))?;

    fs_ext::write_atomic(bin_path, buf.get_ref())
        .map_err(|e| format!("Failed to write '{}': {e}", bin_path.display()))
}

fn is_ptch_file(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).is_ok() && &magic == b"PTCH"
}

fn line_col(text: &str, offset: u32) -> (u32, u32) {
    let offset = (offset as usize).min(text.len());
    let before = &text[..offset];

    let line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line = before.matches('\n').count() as u32 + 1;
    let col = (offset - line_start) as u32 + 1;

    (line, col)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("ritobin-lsp-tests");
        fs::create_dir_all(&dir).unwrap();
        dir.join(format!("{}-{name}", std::process::id()))
    }

    #[test]
    fn round_trip() {
        let path = temp_path("round-trip.bin");
        let bin = ltk_meta::Bin::builder().dependency("base.bin").build();
        let mut buf = Cursor::new(Vec::new());
        bin.to_writer(&mut buf).unwrap();
        fs::write(&path, buf.get_ref()).unwrap();

        let deserialized = deserialize_bin(&path).unwrap();
        assert!(!deserialized.is_override);
        serialize_bin(&path, &deserialized.text).unwrap();

        let reread =
            ltk_meta::Bin::from_reader(&mut BufReader::new(fs::File::open(&path).unwrap()))
                .unwrap();
        assert_eq!(reread, bin);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn bad_magic_is_rejected() {
        let path = temp_path("bad-magic.bin");
        fs::write(&path, b"JUNKJUNKJUNKJUNK").unwrap();

        let err = deserialize_bin(&path).unwrap_err();
        assert!(err.contains("not a League of Legends .bin file"), "{err}");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn ptch_target_is_refused() {
        let path = temp_path("ptch.bin");
        fs::write(&path, b"PTCH\0\0\0\0").unwrap();

        let err = serialize_bin(&path, "").unwrap_err();
        assert!(err.contains("PTCH"), "{err}");
        // the original file must be untouched
        assert_eq!(&fs::read(&path).unwrap()[..4], b"PTCH");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn parse_errors_refuse_save() {
        let path = temp_path("parse-err.bin");
        let err = serialize_bin(&path, "entry: {{{{").unwrap_err();
        assert!(err.contains("Cannot save"), "{err}");
        assert!(!path.exists());
    }
}
