---
title: "arkboot bootloader architecture"
date: 2026-10-19
draft: false
---

### what is arkboot?
arkboot is the custom linux bootloader being built for [arkanaOS](https://github.com/arkana-team/arkanaOS).

most modern linux distros default to GRUB. and while GRUB works, it's honestly massive, bloated, and brings along hundreds of thousands of lines of code just to load a kernel and an initramfs.

the goal with arkboot is keeping things minimal, fast, and transparent:
- supports both legacy BIOS and modern x86-64 UEFI
- freestanding C (no libc, no glibc, no 32-bit userspace libraries required)
- zero dynamic memory allocation / no heap (no `malloc()`, only bounded static buffers and stacks)
- clean bounded YAML boot menu (plus legacy `.cfg` support)
- read-only filesystem drivers implemented directly against raw disk structures
- boots Linux cleanly using standard protocols (32-bit Linux boot protocol on BIOS, EFI stub + `EFI_LOAD_FILE2` on UEFI)

```
                  ┌────────────────────────┐
                  │  shared core (C code)  │
                  │  - filesystem drivers  │
                  │  - MBR / GPT parsing   │
                  │  - YAML / cfg parser   │
                  │  - menu selection      │
                  └───────────┬────────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
        ┌─────────────┐               ┌─────────────┐
        │  BIOS path  │               │  UEFI path  │
        │ (32-bit C)  │               │ (64-bit EFI)│
        └──────┬──────┘               └──────┬──────┘
               │                             │
    32-bit Linux protocol             UEFI EFI stub
               │                      Load File 2 initrd
               ▼                             ▼
        ┌───────────────────────────────────────────┐
        │               Linux Kernel                │
        └───────────────────────────────────────────┘
```

---

### dual boot path: bios vs uefi

#### 1. bios boot path
on legacy BIOS systems:
1. the disk bootstrap reads the core from an embedded LBA recorded at byte 8 (or patches the El Torito boot-information table on CD).
2. stage 1 preserves BIOS `DL`, checks EDD (Extended Disk Drive), and loads the stage 2 core into memory.
3. `loader_entry.asm` sets up the A20 gate, drops into 32-bit protected mode, and clears BSS.
4. whenever C code needs BIOS services (disk reads with INT 13h, video output with INT 10h, or keyboard input with INT 16h), it talks through a serialized bridge that switches back to real mode and uses a dedicated real-mode stack.
5. once an entry is chosen from the menu, the loader validates the bzImage setup header, checks RAM ranges via E820, loads the protected-mode payload and initramfs, builds a clean `boot_params` zero page, sets up Linux GDT selectors, and jumps into Linux's 32-bit entry point.

#### 2. uefi boot path
UEFI handles things very differently:
- the executable is a 64-bit PE32+ application: `/EFI/BOOT/BOOTX64.EFI`.
- compiled with GNU-EFI headers and relocation library, but without libc or utility bloat.
- firmware calls use Microsoft x64 ABI, while internal code stays standard compiler ABI.
- instead of scanning every attached drive, it uses the loaded image device path to find its physical parent Block I/O device.
- initramfs handling is super neat: UEFI firmware only understands FAT filesystems out of the box, but arkboot registers an `EFI_LOAD_FILE2` provider with `LINUX_EFI_INITRD_MEDIA_GUID`.
- when the kernel boots via its EFI stub (`CONFIG_EFI_STUB=y`), Linux requests its initramfs through `EFI_LOAD_FILE2`, allowing arkboot to serve the initramfs directly from ext4 or any other data filesystem without requiring UEFI filesystem drivers!
- after handoff, `StartImage` runs and the kernel stub handles ACPI discovery, framebuffer setup, and `ExitBootServices`.

---

### bios memory ownership
since there is no OS or dynamic allocator running under BIOS, physical memory layout has to be strictly planned:

| physical range | what it's used for |
| --- | --- |
| `0x00000..0x004ff` | BIOS IVT / BDA (untouched) |
| `0x00500..0x00503` | A20 probe scratch |
| below `0x07000` | BIOS bridge stack (grows down) |
| `0x07c00..0x07dff` | disk / CD bootstrap code |
| `0x08000..__bss_end` | core C loader, static buffers, `boot_params` |
| `0x60000..0x67fff` | BIOS bounce buffer (max 32 KiB per request) |
| `0x68000..0x681ff` | EDD packet parameters & E820 scratch |
| below `0x78000` | protected-mode stack (grows down) |
| `0x100000` and above | Linux kernel & initramfs (from usable E820 RAM) |

linker scripts enforce that the BIOS core cannot exceed `0x60000`, preventing any overlap with bounce buffers or stacks.

---

### configuration & menu system
arkboot searches the boot volume for configuration files in this exact order:
1. `/boot/arkboot.yaml`
2. `/boot/arkboot.yml`
3. `/arkboot.yaml`
4. `/arkboot.yml`
5. `/boot/arkboot.cfg`
6. `/arkboot.cfg`

it stops at the first volume containing a config. if a file is invalid, it halts with an error instead of silently falling back.

#### yaml menu format
uses a bounded YAML subset (max 16 entries, max file size 16 KiB, paths <= 511 chars, cmdline <= 2047 chars):

```yaml
default: 0
timeout: 5
entries:
  - title: arkanaOS Linux
    kernel: /boot/vmlinuz
    initrd: /boot/initrd.img
    cmdline: console=tty0 root=UUID=YOUR-ROOT-UUID ro
  - title: arkanaOS (rescue mode)
    kernel: /boot/vmlinuz
    initrd: /boot/initrd.img
    cmdline: console=tty0 root=UUID=YOUR-ROOT-UUID ro single
```

menu controls:
- Up / Down or W / S to navigate
- Enter to boot
- Home / End to jump to first / last entry
- Any key press cancels the countdown timer
- Works over both screen text mode and serial COM1 (115200 baud)

#### legacy cfg format
for direct booting without any menu UI:
```
kernel=/boot/vmlinuz
initrd=/boot/initrd.img
cmdline=console=tty0 root=UUID=YOUR-ROOT-UUID ro
```

---

### filesystems & partitions
all partition and filesystem drivers are written from scratch directly against disk specifications.

partition tables:
- MBR (primary and logical partitions)
- GPT (with header & partition array CRC32 verification)

supported filesystems (all strictly read-only):
- `FAT12`, `FAT16`, `FAT32`
- `ext2`, `ext3`, `ext4` (supports extents, block groups, indirect blocks, directories)
- `ISO9660` (standard CD-ROMs with Rock Ridge extensions)
- `UDF` (ECMA-167 / OSTA UDF bridge optical discs)

files must be regular files inside directories (symlinks are intentionally ignored to prevent loops and bounds issues).

---

### generating images & installing
the repository includes python scripts to generate raw disk/CD images and safely flash them:

#### creating images (`mkimage.py`)
```bash
# raw disk image with ext4 and GPT
python3 scripts/mkimage.py disk --root root --fs ext4 --partition-table gpt --output disk.img

# dual BIOS + UEFI disk image (adds a 64 MiB FAT32 ESP with BOOTX64.EFI)
python3 scripts/mkimage.py disk --root root --fs ext4 --partition-table gpt --uefi --output disk.img

# bootable ISO for optical discs
python3 scripts/mkimage.py iso --root root --output arkboot.iso
```

#### writing to physical media (`write-media.py`)
writing raw boot images to physical disks is always sketchy, so the helper script includes built-in safeguards:
- previews planned commands by default (`--dry-run`)
- refuses to write to mounted partitions, active swap, or LVM/RAID containers
- wipes existing signatures on the target with `wipefs`
- writes raw image from byte 0 and flushes
- verifies written bytes with `cmp`
- moves backup GPT structures to the end of the physical disk using `sgdisk`

```bash
# preview first
python3 scripts/write-media.py disk arkboot.img /dev/sdb --dry-run

# actual write (requires root and interactive confirmation)
sudo python3 scripts/write-media.py disk arkboot.img /dev/sdb --write
```

#### adding uefi arkboot to an existing system
if you already have an existing disk with an EFI System Partition (ESP), you don't have to wipe anything:
```bash
sudo mkdir -p /mnt/esp/EFI/Arkboot
sudo cp BOOTX64.EFI /mnt/esp/EFI/Arkboot/BOOTX64.EFI
sudo efibootmgr --create --disk /dev/nvme0n1 --part 1 \
  --label "Arkboot" --loader '\EFI\Arkboot\BOOTX64.EFI'
```

---

### testing & validation
to make sure things actually boot and don't panic on edge cases, the repo has automated validation in QEMU:
- configuration and filesystem parsers are checked with AddressSanitizer (ASan) and UndefinedBehaviorSanitizer (UBSan).
- builds a minimal pinned Linux 6.12 kernel and a static, libc-free `/init` PID 1 binary.
- boots across all 10 combinations (FAT12/16/32, ext2/3/4, GPT/MBR, ISO9660, UDF) in QEMU.
- verifies that the kernel boots, mounts root, and prints `ARKBOOT_USERSPACE_OK` from userspace PID 1 over serial console.

---

### references & links
repositories:
- arkboot repo: https://github.com/arkana-team/arkboot
- arkana team: https://github.com/arkana-team
- arkanaOS repo: https://github.com/arkana-team/arkanaOS
- arkpkg repo: https://github.com/arkana-team/arkpkg

specifications & docs:
- Linux x86 boot protocol: https://www.kernel.org/doc/html/latest/arch/x86/boot.html
- Linux EFI stub & PE/COFF entry: https://docs.kernel.org/arch/x86/boot.html#pe-coff-entry-point
- Linux zero-page boot parameters: https://docs.kernel.org/arch/x86/zero-page.html
- UEFI 2.11 specification: https://uefi.org/specs/UEFI/2.11/
- ext4 disk layout: https://docs.kernel.org/filesystems/ext4/index.html
- Microsoft FAT documentation: https://learn.microsoft.com/en-us/previous-versions/windows/hardware/fatgen103
- ECMA-119 (ISO 9660): https://ecma-international.org/publications-and-standards/standards/ecma-119/
- ECMA-167 & OSTA UDF specifications: https://www.osta.org/specs/
- GNU-EFI: https://sourceforge.net/projects/gnu-efi/
- xorriso manual: https://www.gnu.org/software/xorriso/man_1_xorrisofs.html
