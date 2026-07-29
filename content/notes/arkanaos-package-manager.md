---
title: "arkanaos package manager architecture"
date: 2026-07-29
draft: false
---

### format & structure
an `.ark` package is literally just an lz4-compressed tar archive with the extension changed to `.ark`. decided to keep it simple instead of writing a custom binary format from scratch.

no config file. no remote repositories or `pacman -Sy`. just local install, remove, list, and search.

everything is plain text.
`/etc/arkpkg/package.db`
list of installed packages

`/etc/arkpkg/packages/<package>.arkinfo`
installed package information

`<package>.tar.lz4`
actual package archive

### package contents
inside an `.ark` file (like `bash-5.3.0-x86_64.ark`):
```
bash-5.3.0-x86_64.ark
│
└── lz4 container
    │
    └── tar Archive
        │
        ├── ARKPKG          ← metadata
        └── package/        ← filesystem to install
             ├── usr/
             ├── etc/
             ├── var/
             └── ...
```

### metadata
the `ARKPKG` file contains simple metadata. looks something like this:
```
Name: bash
Version: 5.3.0
Release: 1
Arch: x86_64
License: GPL-3.0-or-later
Homepage: https://www.gnu.org/software/bash/
Description: GNU Bourne Again SHell
Dependencies:
    glibc>=2.42
Provides:
    sh
Conflicts:
    busybox
```

### installed info
after installing, `/etc/arkpkg/packages/<package name>.arkinfo` gets generated. contains all the standard info:
```
Name: bash
Version: 5.3.0
InstalledAt: 2026-07-30T15:42:19Z

Files:
/usr/bin/bash
/usr/bin/rbash
/etc/bash.bashrc

Checksums:
4fd0...  /usr/bin/bash
73ab...  /usr/bin/rbash
8cf2...  /etc/bash.bashrc
```

### how to inspect
because it's just lz4 + tar, you don't even need the package manager to look inside:
```
lz4 -dc bash-5.3.0-x86_64.ark | tar -tvf -
```
no custom unpacker required. very easy to debug and maintain.

### language
wrote it in rust. python is too slow, go binaries are too heavy (~40mb). rust is fast, safe, and i already know it.

### links
arkpkg repo: https://github.com/arkana-team/arkpkg
arkana team: https://github.com/arkana-team
