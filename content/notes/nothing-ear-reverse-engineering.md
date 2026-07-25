---
title: "nothing ear reverse engineering"
date: 2026-07-25
draft: false
---

ok so this literally started because i wanted Nothing X on desktop. thought it'd be a weekend project. ended up learning way more bluetooth than i ever intended to.
first repos i found
https://github.com/DaanHessen/earctl
https://github.com/radiance-project/ear-web
https://github.com/Bestello/dms-nothingx
had all 3 open side by side basically the whole project.
earctl = cleanest implementation.
ear-web = "how tf does this even work in a browser".
dms-nothingx = easiest place to quickly change packets.
started with ear-web because browser implementation was probably going to reveal transport immediately.
opened bluetooth_socket.js.
expected
```js
navigator.bluetooth.requestDevice()
```
instead found
```js
navigator.serial.requestPort()
```
thought i opened the wrong file.
why tf are bluetooth earbuds using serial.
ended up reading chromium docs because i genuinely thought i misunderstood Web Bluetooth.
turns out Web Bluetooth intentionally only supports BLE GATT.
https://github.com/WebBluetoothCG/web-bluetooth
which immediately explains why ear-web exists.
found this afterwards
https://developer.chrome.com/blog/serial-over-bluetooth
chrome basically exposes RFCOMM/SPP devices through Web Serial.
browser
↓
Web Serial
↓
RFCOMM
↓
Nothing Ear
still think that's cursed.
interesting thing is ear-web doesn't just enumerate every serial device.
it filters using
```js
allowedBluetoothServiceClassIds
```
with
```
aeac4a03-dff5-498f-843a-34487cf133eb
```
also noticed references to
```
df21fe2c-2515-4fdb-8886-f12c4d67927c
```
Google Fast Pair UUID.
still need to read chromium source because i'm curious whether Web Serial filters at the browser level or delegates everything to the OS.
at this point i still assumed companion communication happened over BLE.
wrong.
reading earctl + dms-nothingx pretty quickly made it obvious almost everything interesting goes through RFCOMM/SPP instead.
pairing = BLE.
advertising = BLE.
Fast Pair = BLE.
actual protocol = RFCOMM.
RFCOMM docs
https://www.bluetooth.com/specifications/specs/rfcomm-1-2/
SPP docs
https://www.bluetooth.com/specifications/specs/serial-port-profile-1-2/
honestly makes implementation way simpler.
every implementation basically ends up doing
```python
sock.send(packet)
packet = sock.recv(...)
```
instead of messing around with dozens of GATT characteristics.
another thing i learnt pretty quickly.
RFCOMM channels are NOT fixed.
original assumption
```
channel 15
done
```
wrong.
Bluetooth uses SDP.
client asks where the RFCOMM service currently lives.
device replies with current channel.
explains why earctl scans channels every single connection.
https://www.bluetooth.com/specifications/specs/service-discovery-protocol-1-1/
probably worth caching successful channels though.
MAC
↓
channel
↓
timestamp
invalidate cache after failures.

packet framing seems basically identical across earctl, ear-web and dms-nothingx which is nice because if three completely different implementations all build the exact same bytes then the framing is probably correct.
```
55 60 01
CMD
DIR
LEN
00
OP_ID
PAYLOAD
CRC16_LE
```
direction values i've confirmed so far
```
C0 = GET
F0 = SET
40 = GET RESPONSE
70 = SET ACK
E0 = EVENT / unsolicited
```
still need to see if there are any other direction values floating around. earctl enums don't seem to mention any.
CRC implementation looks like CRC16 ANSI everywhere.
```
poly = 0x8005
```
little endian output.
need to compare lookup table implementations because earctl and ear-web generate the same CRC but the implementations look slightly different.
another thing i noticed is literally every implementation eventually does the exact same thing.
```
build packet
↓
calculate crc
↓
append crc
↓
send bytes
```
which makes me think it might be worth writing a packet builder instead of every command constructing bytes manually.
first thing i tested myself was battery.
GET
```
07
```
response
```
40
```
sample payload
```
55 60 01 07 40 05 00 01 02 02 5a 03 55 92 91
```
currently looks something like
```
left
right
case
```
but still haven't mapped every byte.
need captures while charging.
need captures with one earbud missing.
need captures with case open.
firmware command was surprisingly boring.
GET
```
42
```
response payload
```
31 2e 30 2e 31 2e 35 31
```
literally ASCII.
```
1.0.1.51
```
expected weird binary structure.
instead firmware just says "here's a string lol".
ANC
GET
```
1E
```
SET
```
0F
```
known payload
```
01 01 00
```
high ANC.
need to map
```
off
low
mid
high
adaptive
transparency
```
using captures instead of guessing.
another thing i noticed.
GET and SET command ids usually AREN'T the same.
i originally assumed
```
GET ANC
0F
SET ANC
0F
```
instead it's more like
```
GET
1E
SET
0F
```
same feature.
completely different command ids.
same thing seems to happen with EQ.
GET
```
1F
```
SET
```
10
```
legacy implementations kept mentioning
```
50
```
spent ages thinking my implementation was broken.
turns out Ear (a) just uses different commands.
don't assume commands work across models.
need model specific database.
maybe
```
B162
↓
command map
```
instead of global enums.
Find My commands were easier than expected.
left
```
02
```
right
```
03
```
payload
```
01
```
start ringing.
```
00
```
stop.
tested both.
worked.
well...
first attempt only left rang.
second attempt only right.
third attempt finally both.
logs were also complaining about RFCOMM being busy so that probably didn't help.
parser notes because firmware immediately broke my first implementation.
DO NOT PARSE DIRECTLY FROM recv().
recv() returns arbitrary byte chunks.
examples i've captured
```
packet
```
```
packet
packet
```
```
half packet
```
```
packet
half packet
```
```
half
half
```
need streaming parser.
maintain byte buffer.
search for
```
55 60
```
parse length.
verify crc.
remove bytes.
repeat until no complete packet exists.
also captured packets beginning with
```
55 00
```
instead.
currently assuming unsolicited events.
need more captures.
firmware behaviour is honestly kinda weird.
sometimes response ordering looks like
```
GET
↓
RESPONSE
```
other times
```
SET
↓
EVENT
↓
ACK
```
other times
```
EVENT
EVENT
ACK
```
parser should never assume ordering.
match using OP_ID instead.
still need to figure out exactly how OP_ID behaves.
currently just increments.
need to test rollover.
need to test duplicate OP_ID.
need to test parallel requests.
interesting experiment later.
send
```
battery
firmware
ANC
```
without waiting for responses.
see whether firmware always preserves ordering.
if not then OP_ID becomes mandatory.
need to dump unknown packets instead of ignoring them.
current parser basically does
```
known
↓
decode
```
everything else disappears.
bad idea.
better
```
known
↓
decode
unknown
↓
hex dump
↓
timestamp
↓
save
```
future firmware might add commands nobody has documented.
would suck to silently throw them away.
device info command
```
06
```
still basically a mystery.
payload is huge compared to every other command.
serial number definitely lives in there somewhere.
probably manufacturing info too.
need multiple captures from different earbuds.
need older firmware.
need newer firmware.
maybe diff payloads.
gesture packets are another thing i wanna decode.
current payloads look something like
```
40 21 ...
```
lots of repeated bytes.
probably TLV.
haven't looked closely enough yet.
would be nice to map
```
double tap
triple tap
pinch hold
volume swipe
```
to actual payload structures.
latency mode seems straightforward.
GET
```
41
```
response is tiny.
need SET command.
need payload mapping.
probably just enum values.
battery percentages are weird.
left and right obvious.
case obvious.
other bytes probably charging state.
need captures
```
charging
not charging
lid closed
lid open
single earbud
```
and compare.
another thing i wanna test.
send deliberately invalid payloads.
example
```
ANC
09
```
instead of
```
00
01
02
03
```
does firmware reject it.
ignore it.
disconnect.
or accept it and do something weird.
probably don't fuzz too aggressively until i understand more.
official Nothing X would be really useful here.
capture traffic.
change one setting.
capture again.
diff packets.
repeat.
way easier than guessing.
need btmon running.
```
sudo btmon
```
save logs.
import into Wireshark later.
Wireshark is nicer for viewing.
btmon seems better for collecting.
need to compare against Android.
Android almost definitely just uses
```
BluetoothSocket
```
https://developer.android.com/reference/android/bluetooth/BluetoothSocket
which explains why companion app code probably looks surprisingly normal.
Android handles SDP.
Android handles RFCOMM.
application just gets streams.
Linux needs slightly more manual work.
RFCOMM sockets being exclusive wasted way too much time.
```
Device or resource busy
```
doesn't necessarily mean code is broken.
usually just means something else already owns the socket.
browser.
earctl.
another script.
one connection at a time.
future parser should probably support recording raw traffic.
```
timestamp
TX
RX
decoded
raw hex
```
don't wanna lose unknown packets.
documentation should be generated from command database instead of handwritten.
every command eventually needs
```
name
command id
GET/SET
payload
response
supported models
confirmed by capture?
source repo
notes
```
that way documentation stays synced with implementation instead of drifting over time.
still need to investigate
- custom EQ
- advanced EQ
- firmware update protocol
- gesture payload decoding
- wear detection events
- serial number structure
- unknown command ids from earctl
- capability handshake
- firmware differences between models
- spontaneous battery notifications
- OP_ID behaviour
- malformed payload handling
- notification/event packet formats
need to compare protocol against older Nothing devices at some point. pretty sure Ear (1), Ear (2), Ear (a) and Ear (2024) all share the same basic framing but command ids definitely diverge. transport seems mostly stable, application layer doesn't.
known internal model names i've seen
```
B155
Ear (2)

B162
Ear (a)

B171
Ear (2024)

B163
CMF Buds Pro
```
need to build command database by model instead of pretending every device behaves the same.
thinking command database should probably look something like
```json
{
  "anc": {
    "get": 30,
    "set": 15,
    "models": [
      "B162",
      "B171"
    ]
  }
}
```
instead of hardcoding
```python
if model == ...
```
everywhere.
documentation should probably be generated from command database instead of handwritten markdown.
something like
```
command database
↓
markdown
↓
api docs
↓
cli help
```
one source of truth.
same database could also power packet decoder.
```
packet
↓
command id
↓
database lookup
↓
pretty output
```
instead of giant switch statements.
capture tool should probably never decode packets directly.
better
```
capture bytes
↓
parser
↓
database
↓
decoded output
```
makes adding new commands much easier.
also want parser to preserve unknown packets forever.
```
timestamp
direction
command
raw hex
payload
crc valid?
```
even if decoder has no clue what command actually means.
future me will thank present me.
thinking of making every capture automatically save
```
raw.log
decoded.log
json
```
json would make diffing firmware versions really easy.
something like
```
capture
↓
json
↓
jq
↓
diff
```
another thing.
every packet currently gets allocated as a new bytes object.
probably unnecessary.
parser could just keep one bytearray and slice using offsets.
less allocations.
probably doesn't matter for battery polling but might matter if notifications start flooding.
need to investigate unsolicited notifications more.
currently only really understand request/response flow.
possible event sources
```
battery changed
ear inserted
ear removed
ANC changed externally
case opened
case closed
multipoint events
```
haven't actually captured enough idle traffic yet.
need longer recordings.
also wanna leave btmon running while only interacting through official Nothing X.
change ONE thing.
stop capture.
repeat.
should make packet diffing much easier.
example
```
capture
↓
change EQ preset
↓
capture
↓
compare
```
same for
```
ANC
gestures
latency
dual connection
```
don't wanna keep guessing payloads if i can literally observe them.
need to compare btmon vs hcidump captures too.
hcidump is basically dead now.
btmon seems to be the official recommendation.
Wireshark is nicer afterwards though.
https://github.com/bluez/bluez/wiki/btmon
https://www.wireshark.org/docs/dfref/b/btrfcomm.html
another thing i realised.
Nothing X almost definitely builds its UI dynamically.
probably something like
```
connect
↓
device info
↓
firmware
↓
capabilities
↓
show supported pages
```
instead of shipping separate UI for every model.
desktop app should probably do the same.
GUI shouldn't know command ids.
GUI shouldn't know payloads.
GUI shouldn't know packet framing.
GUI should literally just call
```python
device.anc.high()
device.find.left()
device.eq.custom(...)
```
everything underneath stays inside library.
library should expose high level objects only.
packet ids stay internal.
another thing i wanna test.
disconnect one earbud.
capture battery.
disconnect opposite earbud.
capture again.
put both in case.
capture again.
probably enough to identify unknown battery bytes.
same thing for charging.
```
left charging
right charging
case charging
```
need captures for all combinations.
still don't know if battery payload is TLV or fixed layout.
looks fixed but not 100% sure.
need more firmware versions too.
current firmware
```
1.0.1.51
```
would be interesting to compare against launch firmware.
protocol changes should become obvious.
also wondering if firmware update packets use completely different framing.
haven't looked into OTA at all yet.
probably don't wanna poke those commands randomly.
another random observation.
Nothing protocol is honestly pretty clean.
header.
length.
payload.
crc.
done.
expected something significantly more cursed.
compare that to some IoT devices with encrypted protobuf inside compressed payloads wrapped in JSON inside BLE lol.
another thing.
packet builder should probably expose
```python
Packet(
    command=...,
    direction=...,
    payload=...
)
```
instead of manually constructing bytes every time.
same for parser.
```
bytes
↓
Packet
```
instead of returning tuples.
command handlers become much cleaner.
still haven't figured out whether command ids are grouped intentionally.
noticed
```
0F
ANC SET

10
EQ SET

1E
ANC GET

1F
EQ GET
```
could just be coincidence.
need full command list.
might reveal numbering pattern.
would also be interesting to compare against firmware strings.
maybe newer firmware adds contiguous command ranges.
need more devices.
things i'm still curious about
- why application layer CRC when bluetooth already has CRC
- why RFCOMM instead of BLE GATT
- whether Fast Pair UUID is actually required
- why GET and SET ids differ
- why firmware sometimes ACKs after events
- why some responses concatenate into single recv()
- whether parser ever needs timeout reassembly
- whether firmware compresses anything
- whether unknown payload bytes are flags or reserved
- whether there are vendor debug commands
also wanna compare against Sony and JBL companion apps.
not because protocol will match.
mostly curious whether RFCOMM companion apps are still common or if Nothing is one of the last companies still using it.
AirPods are basically a completely different universe.
lots of proprietary BLE.
Apple vendor ids.
private advertisements.
encrypted payloads.
Nothing feels refreshingly boring in comparison.
last thing.
don't trust source code over captures.
source tells you what developers intended.
captures tell you what actually happened.
if earctl says one thing.
ear-web says another.
dms-nothingx says something else.
trust the earbuds.
they're the protocol.
everything else is just someone's interpretation of it.
useful links
https://github.com/DaanHessen/earctl
https://github.com/radiance-project/ear-web
https://github.com/Bestello/dms-nothingx
https://developer.chrome.com/blog/serial-over-bluetooth
https://github.com/WebBluetoothCG/web-bluetooth
https://www.bluetooth.com/specifications/specs/rfcomm-1-2/
https://www.bluetooth.com/specifications/specs/serial-port-profile-1-2/
https://www.bluetooth.com/specifications/specs/service-discovery-protocol-1-1/
https://www.bluetooth.com/specifications/specs/logical-link-control-and-adaptation-protocol-specification-1-3/
https://developer.android.com/reference/android/bluetooth/BluetoothSocket
https://github.com/bluez/bluez
https://github.com/bluez/bluez/wiki/btmon
https://www.wireshark.org/docs/dfref/b/btrfcomm.html
https://source.android.com/docs/core/connect/bluetooth
TODO
- decode device info payload
- dump unknown commands
- compare firmware versions
- compare different ear models
- map every ANC payload
- map every EQ payload
- decode gestures completely
- identify notification packets
- verify OP_ID rollover
- fuzz invalid payloads (carefully)
- capture official Nothing X traffic
- compare btmon vs RFCOMM payloads
- build command database
- auto generate docs from command database
- write proper streaming parser
- eventually stop pretending this is "just a desktop app"
random things worth looking into later because i know i'm gonna forget them otherwise.
Chrome 117 was apparently the first version to expose Bluetooth RFCOMM devices through Web Serial. need to read chromium commit history and figure out exactly what changed because ear-web wouldn't have been possible before that.
https://developer.chrome.com/blog/serial-over-bluetooth
might also be worth reading chromium implementation instead of just docs.
https://source.chromium.org/
still haven't actually looked at BlueZ's RFCOMM implementation either. only interacted with it through bluetoothctl and sockets. would be interesting to see how SDP discovery is actually implemented.
https://github.com/bluez/bluez
BlueZ docs mention SDP records, RFCOMM sockets and profile registration separately. might explain why channel allocation appears dynamic instead of fixed.
another thing.
earbuds almost definitely don't expose ONLY one RFCOMM service.
need to dump complete SDP record instead of only searching for serial service.
```bash
sdptool browse <MAC>
```
might reveal services nobody has looked at.
also wanna compare outputs between firmware versions.
need to try
```bash
bluetoothctl menu gatt
list-attributes
```
again after firmware updates even though protocol doesn't seem GATT based. maybe some read-only characteristics changed.
there's also this weird thing where browser always says
```
Serial Device
```
instead of
```
Bluetooth Device
```
makes sense technically because Web Serial has no idea what transport is underneath but still funny.
need to investigate if WebUSB has something similar.
official Android app almost definitely just calls
```java
BluetoothDevice.createRfcommSocketToServiceRecord(UUID)
```
https://developer.android.com/reference/android/bluetooth/BluetoothDevice#createRfcommSocketToServiceRecord(java.util.UUID)
would be interesting to decompile Nothing X apk at some point.
not really to steal code.
mostly to compare packet construction.
apktool + jadx should be enough.
https://ibotpeaches.github.io/Apktool/
https://github.com/skylot/jadx
also wondering if protobuf exists anywhere inside apk.
wouldn't be surprised if packet builders are generated internally.
need to grep for
```
55 60
```
inside decompiled apk.
if that literal header exists then packet builder probably lives there too.
if not then packets are assembled dynamically.
another thing.
should probably collect firmware from as many people as possible.
different firmware
different earbuds
different regions
build matrix.
```
model
firmware
supported commands
notes
```
would make command compatibility much easier.
also noticed earctl has way more enums than i've actually tested.
need to go through every single command one by one.
categorise as
```
works
timeout
unknown
dangerous
```
don't wanna accidentally send firmware update commands though.
maybe maintain allowlist.
also need confidence levels.
```
confirmed by capture
confirmed by source
tested myself
guess
```
too many protocol docs online mix confirmed stuff with speculation.
don't wanna do that.
packet capture naming scheme maybe
```
YYYY-MM-DD_HH-MM-SS_model_firmware_action.btmon
```
example
```
2026-07-24_B162_1.0.1.51_anc_high.btmon
```
future me will appreciate that.
also save decoded version.
don't rely on decoder existing forever.
parser probably needs tests using REAL captures instead of fake packets.
take capture.
split randomly.
feed parser random chunk sizes.
verify reconstructed packets match original.
examples
```
1 byte
2 bytes
5 bytes
17 bytes
64 bytes
```
parser shouldn't care.
another thing i realised.
packet length should always be trusted more than recv().
recv() is transport.
length is protocol.
protocol always wins.
need to verify whether malformed length causes parser desync.
probably recover by scanning for next
```
55 60
```
instead of assuming stream is dead.
thinking parser states could literally just be
```
SEARCH_HEADER
READ_HEADER
READ_PAYLOAD
VERIFY_CRC
DISPATCH
```
instead of one giant parse() function.
also wondering if notifications can interleave with responses.
if yes parser needs event callbacks independent of pending requests.
something like
```python
device.on_event(...)
```
instead of treating everything as request/response.
would make wear detection much easier too.
need to capture
```
put earbud in
remove earbud
touch controls
ANC pinch
case open
case close
```
without polling anything.
see what firmware sends by itself.
another thing.
should compare Linux against Windows.
wonder if Windows exposes same RFCOMM service through COM ports.
if yes then desktop app becomes way easier.
if not then probably need platform abstraction.
also wanna see how macOS handles it.
still haven't looked at BlueZ source.
still haven't looked at Android Fluoride source.
still haven't looked at Chromium serial implementation.
lots of reading left.
https://source.android.com/docs/core/connect/bluetooth
https://android.googlesource.com/platform/packages/modules/Bluetooth/
another random observation.
Nothing protocol feels surprisingly "embedded".
tiny payloads.
fixed headers.
simple CRC.
almost no unnecessary metadata.
feels like something designed around MCU constraints instead of desktop software.
wouldn't be surprised if same protocol is shared between Android, iOS and factory testing tools.
factory/service tools are another rabbit hole.
if Nothing has internal diagnostics software then protocol is probably documented somewhere internally.
obviously not public.
wonder if any leaked firmware contains symbols.
need to search strings from firmware images if i ever get one.
also curious whether earbuds expose debug UART pads.
probably not taking them apart anytime soon though.
another thing i wanna investigate.
does protocol version exist.
right now i'm assuming firmware version == protocol version.
might be wrong.
there could be hidden capability/version command.
packet ids seem low enough that there are definitely undocumented commands.
also wanna compare against FCC filings if teardown photos exist.
might reveal bluetooth chipset.
knowing chipset might explain why protocol looks the way it does.
if it's Qualcomm then maybe parts of protocol are inherited.
same if BES or Airoha.
chipset might also explain OTA format.
need teardown photos.
https://fcc.report/
also worth checking
https://www.ifixit.com/
possible future tooling
```
capture.py
```
continuous logger.
```
nothingctl
```
cli.
```
packet-diff.py
```
compare captures.
```
firmware-diff.py
```
compare responses across firmware.
```
command-scan.py
```
safe GET scanner.
```
crc-tool.py
```
verify packet CRCs.
```
model-db.json
```
command compatibility.
still think biggest discovery wasn't even a packet.
it was realising the whole ecosystem isn't BLE like i originally assumed.
once RFCOMM clicked everything else suddenly made way more sense.
browser implementation.
Android implementation.
socket API.
packet framing.
CRC.
all of it.
current confidence
```
RFCOMM transport        100%
packet framing          100%
CRC16                   100%
battery                 100%
firmware                100%
ANC                     100%
Find My                 100%
EQ                      ~70%
gestures                ~40%
device info             ~20%
notification packets    ~20%
OTA                     0%
```
good enough to build a desktop app.
nowhere near enough to call protocol fully documented.
```

random repo observations because i kept forgetting where i saw stuff.
earctl feels closest to "reference implementation". rust enums make command hunting really easy.
ear-web is probably the best place to understand transport and browser quirks.
dms-nothingx is honestly the easiest place to prototype because changing python is faster than rebuilding rust every minute.
need to remember not to trust only one repo.
if
```
earctl
```
says one thing
```
ear-web
```
says another
and
```
captures
```
say something else
captures win.
also noticed all 3 repos implement almost identical CRC logic independently.
that's actually a good sign because they weren't copied from each other.
worth comparing generated CRCs against live captures though.
need collection of "known good packets".
something like
``` id="uq7olx"
battery request
battery response
firmware request
firmware response
ANC high
ANC off
Find My left
Find My right
```
use these as regression tests later.
another parser idea.
parser shouldn't know commands.
parser should ONLY know framing.
```
bytes
↓
Packet
```
that's it.
decoder should be separate.
```
Packet
↓
CommandDecoder
↓
ANC
Battery
Firmware
Unknown
```
otherwise parser becomes giant mess.
same thing for CRC.
packet parser shouldn't calculate CRC manually.
just
```python id="z58g5t"
crc.verify(packet)
```
keeps everything separate.
thinking packet object should eventually look like
```python id="22syuy"
Packet(
    header=...,
    command=...,
    direction=...,
    op_id=...,
    payload=...,
    crc=...
)
```
instead of returning tuples.
another thing.
command handlers shouldn't even know packet layout.
```
battery.get()
```
should internally become
```
command database
↓
packet builder
↓
transport
↓
parser
↓
decoder
```
much easier to maintain.
need actual transport abstraction too.
currently everything assumes Linux RFCOMM sockets.
future probably needs
```
Linux RFCOMM
Windows RFCOMM
Android
maybe macOS
```
all exposing same API.
possible interface
```python id="ty1dzz"
transport.send()
transport.recv()
transport.connect()
transport.disconnect()
```
parser doesn't care where bytes came from.
thinking capture.py should support "raw mode".
literally don't decode anything.
just
``` id="ezomwz"
timestamp
RX
hex
```
sometimes decoder bugs are harder to notice than parser bugs.
raw log should always exist.
also want "annotated mode".
```
RX
55 60 ...

↓

Battery Response
```
same capture.
two outputs.
would be nice if unknown packets automatically got numbered.
```
UNKNOWN_001
UNKNOWN_002
```
instead of disappearing forever.
another thing.
hex dumps should always preserve spacing exactly.
example
``` id="qun6ra"
55 60 01 07 40 05 00 01 02 02 5A 03 55 92 91
```
don't compress.
don't lowercase.
makes visual diffing much easier.
also thinking about writing tiny packet visualiser.
input
``` id="lgq5hy"
556001074005000102025a03559291
```
output
```
Header
55 60

Command
07

Direction
40

Payload
02 02 5A

CRC
9291
```
basically Wireshark but tiny.
command database should probably also track confidence.
example
``` id="jlwmrp"
Battery
100%

Firmware
100%

ANC
100%

EQ
70%

Gestures
40%

OTA
0%
```
way easier than pretending everything is solved.
another thing i realised.
"works" isn't enough.
should distinguish
```
works because tested

works because source says so

works because inferred
```
otherwise notes become misleading after a few months.
also wanna keep source references beside every discovery.
example
```
battery

earctl
✓

ear-web
✓

capture
✓
```
or
```
EQ

earctl
✓

ear-web
✓

capture
✗
```
immediately obvious what's actually confirmed.
another weird firmware thing.
responses are FAST.
way faster than i expected.
need actual timing measurements.
```
request
↓

response
```
measure latency.
maybe
```python id="fb5imj"
time.monotonic_ns()
```
before send.
same after receive.
build latency table.
interesting to compare
```
battery
firmware
ANC
Find My
```
maybe some commands are noticeably slower.
also need timeout table.
current timeout is basically guesswork.
better approach
```
command
↓

average response time
↓

timeout = avg * 5
```
instead of fixed timeout.
another thing i noticed.
battery request is tiny.
battery response also tiny.
protocol seems heavily optimised around keeping payloads small.
wouldn't surprise me if firmware runs on pretty constrained MCU.
need chipset info.
teardown might help.
still wanna identify bluetooth chip.
Qualcomm?
BES?
Airoha?
Actions?
chipset probably explains lots of protocol decisions.
another experiment.
compare idle traffic.
connect.
don't touch anything.
record 10 minutes.
see if earbuds send anything spontaneously.
possible events
```
battery
RSSI
heartbeat
keepalive
```
currently no idea.
also curious whether companion app polls battery or waits for notifications.
captures would answer that instantly.
need Android phone + btmon somehow.
still need to investigate multipoint.
currently assuming
```
phone
+
desktop
```
works.
not sure if both devices can simultaneously hold RFCOMM.
probably not.
worth testing.
also wanna know if official app disconnects after changing settings.
might explain why battery impact stays low.
future tools that would actually be useful.
``` id="sffv2i"
packet-replay.py
```
replay captures.
``` id="rcl2w5"
packet-diff.py
```
compare firmware.
``` id="ay7wxh"
command-search.py
```
find commands by payload bytes.
``` id="y0wc3r"
capture-viewer.py
```
pretty print logs.
``` id="e7vq7q"
live-monitor.py
```
watch notifications in real time.
also thinking of writing tiny fuzz tool eventually.
VERY conservative.
GET commands first.
small payload mutations.
rate limited.
don't wanna accidentally soft brick earbuds because i got curious at 3am.
last note because this keeps coming back.
protocol reverse engineering should always follow
```
capture
↓

observe

↓

hypothesis

↓

test

↓

capture again

↓

confirm
```
NOT
```
read source

↓

assume correct
```
source code lies surprisingly often.
firmware doesn't.
```

couple random protocol ideas before i inevitably forget them.
need proper command scanner.
NOT brute force.
only known-safe GET space.
something like
``` id="5k3g3o"
0x01
↓

0x7F
```
GET only.
log
``` id="xqbjlwm"
response
timeout
disconnect
unknown
```
anything that disconnects immediately goes on do-not-touch list.
another thing.
might be worth building command family tree.
example
``` id="g6vmp3"
0x0F ANC SET
0x1E ANC GET

0x10 EQ SET
0x1F EQ GET

0x41 LATENCY GET
??
LATENCY SET
```
looks like there might actually be some numbering logic instead of random assignments.
need full command list before jumping to conclusions.
also need command aliases.
same feature.
different models.
don't duplicate documentation.
maybe
```json id="uddkuz"
{
  "anc": {
    "B162": {
      "get": "0x1E",
      "set": "0x0F"
    },
    "B171": {
      "get": "...",
      "set": "..."
    }
  }
}
```
still think command database is the single most important thing to build.
everything else can generate from it.
CLI.
GUI.
docs.
decoder.
capture.
API.
all reading same database.
also need packet corpus.
literally just folder of confirmed packets.
``` id="lbv8pr"
battery.req
battery.res
firmware.req
firmware.res
anc_high.req
anc_high.ack
find_left.req
find_right.req
```
good for parser tests.
good for CRC tests.
good for regressions.
would also be nice to record firmware alongside every packet.
``` id="qqf5an"
1.0.1.51
battery.req
```
future firmware might change responses.
need to know where captures came from.
another thing.
should never throw away unknown payload bytes.
even if decoder only understands
``` id="r0gqkk"
byte 0
byte 1
byte 2
```
still preserve
``` id="x8yz6v"
byte 3
byte 4
byte 5
...
```
future discoveries become impossible otherwise.
thinking docs should eventually distinguish
``` id="fb8vmh"
confirmed

likely

guess

unknown
```
instead of pretending everything is solved.
also wanna keep changelog.
``` id="o3kz8f"
2026-07-23
found firmware command

2026-07-24
found Find My

2026-07-25
confirmed parser fixes
```
would be funny looking back a year later.
need actual captures from more people too.
one pair of earbuds isn't enough.
different firmware.
different hardware revisions.
different regions.
different models.
if protocol docs ever become public then contributions should REQUIRE capture files.
not just "trust me bro".
another random thing.
don't build desktop app around Ear (a).
build it around protocol.
device should just advertise capabilities.
UI appears automatically.
means newer earbuds hopefully "just work".
still don't know if Nothing watches use anything similar.
probably completely different.
haven't looked.
project name still undecided lol.
"nothingx" probably asking for trademark issues.
"ear-web" already exists.
"earctl" already exists.
"openear" already exists because Nothing literally made Ear (open).
still haven't found one i actually like.
maybe doesn't matter until protocol is properly documented.
another thing.
need proper contribution guide eventually.
something like
``` id="zb4cuw"
capture traffic

↓

open issue

↓

attach logs

↓

state firmware

↓

state model

↓

state OS
```
instead of screenshots.
packet captures > screenshots.
also wanna make sure docs don't slowly become wiki pages.
i'd rather keep them as raw notes.
if something is wrong later i can just append
``` id="56mwz5"
EDIT:
this was wrong.
firmware 1.0.2 changed it.
```
instead of rewriting history.
that's honestly why i like notes more than documentation.
you can actually see how understanding evolved.
last random thought.
kinda funny how this started because i wanted a desktop app to toggle ANC.
few days later i'm reading Bluetooth SIG specs, Chromium source, Android Bluetooth APIs, packet captures, CRC implementations and writing streaming parsers.
definitely wasn't the original plan.
also definitely not complaining.
current status
``` id="t0bp6v"
transport
██████████ 100%

packet framing
██████████ 100%

CRC
██████████ 100%

battery
██████████ 100%

firmware
██████████ 100%

ANC
██████████ 100%

Find My
██████████ 100%

latency
███████░░░ ~70%

EQ
██████░░░░ ~60%

gestures
█████░░░░░ ~50%

device info
██░░░░░░░░ ~20%

notifications
██░░░░░░░░ ~20%

OTA
░░░░░░░░░░ 0%
```
still a LONG way to go before i'd call the protocol fully documented.
good enough to build software though.
that's probably the important part.
