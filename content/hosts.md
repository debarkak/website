---
title: "/hosts"
date: 2026-07-08
---

i originally wanted to host this website myself. not on GitHub Pages.

i already have an Oracle Cloud OCI VM that's online 24/7 (free tier of course, because i am broke), so it would've worked just fine. i usually prefer hosting my own projects myself. it gives me a level of control that i honestly can't explain. (autism moment.)

another reason was that my brother, [@preetamsad](https://github.com/preetamsad), has also been considering self-hosting his own website. i remember him asking me (and a few people in his discord server) whether he should host it on a Raspberry Pi 5 or on his VPS.

so naturally i also wanted to self-host mine.

after thinking about it for a while, and after asking a lot of people for advice, i eventually settled on GitHub Pages.

the reasoning is that, because i spent too long building this website, even with the help of AI, it took me too long, because of the fact i kept getting lost on building this website. and plus general phone addiction and sleepless watch nights is destroying my brain, i admit to it, i don't sleep at night. (not always, some days i sleep)

because of the time, i decided to host my website on GitHub Pages.
because...

* firstly, GitHub does provide a LetsEncrypt SSL Certificate for you, you don't have to do anything else, other than just click a lazy check box.

* secondly, because GitHub has more servers than i could ever dream of, since because of that, if you open this website, it will open up faster than if i hosted this on Oracle, because GitHub can distribute the same website to multiple servers in multiple locations, and connect to the nearest one and then open the website. and my server is only located in one location, Hyderabad. 

* thirdly, if i ever accidentlly break something in my Oracle server, or if anything happens, even then my website would still be live.


however, i will be hosting everything else, like public FTP servers, etc. on my Oracle server, as the time i am writing this, my personal homelab server, which was a Dell Inspiron N4110, died around ~19 hours ago. (timed at the time of me writing this document.)

because of that i will rely on my Oracle server for all my other services, I will use my Raspberry Pi 5 as a NAS, it runs Windows 11 (reasons in a later blog post).

and because my oracle server is arm64, compiling x86 software (or running x86-only things) isn't always practical.

huge thanks to [@celunah](https://github.com/celunah) for letting me use one of his VPSes. it's in the US, has around 30 GB of storage, and the latency from india is... not great. but it gets the job done.

i might compile LFS on it one day. because why not.

now for conclusion,

could i host everything on oracle?

absolutely.

should i?

probably not.

sometimes the boring solution really is the better one. (my parents are right.)