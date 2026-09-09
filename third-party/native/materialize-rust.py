"""Create a Cargo directory source from shipped crates; Python 3.12+ required."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

source = Path(__file__).resolve().parent
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=False)
manifest = json.loads((source / 'materials.json').read_text())
for entry in manifest['materials']:
    if not entry['file'].endswith('.crate'):
        continue
    archive = source / entry['file']
    # A platform's source delivery can be a subset of the global manifest.
    if not archive.exists():
        continue
    if hashlib.sha256(archive.read_bytes()).hexdigest() != entry['sha256']:
        raise ValueError(f"source digest mismatch: {entry['file']}")
    with tarfile.open(archive) as contents:
        contents.extractall(output, filter='data')
    directory = output / archive.name.removesuffix('.crate')
    checksums = {p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in directory.rglob('*') if p.is_file()}
    (directory / '.cargo-checksum.json').write_text(json.dumps({'package': entry['sha256'], 'files': checksums}))
print('[source.crates-io]\nreplace-with = "vendored-sources"\n[source.vendored-sources]\ndirectory = ' + json.dumps(str(output)))
