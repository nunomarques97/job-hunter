# Sources

Every job source this product may read, what it actually returns, and the
published basis on which it is read. Blueprint §10 is the plan; this file is
what the plan turned out to be true about. Where the two disagree, this file is
the one that was measured.

Three rules hold for every row below. A source is read only through an endpoint
its publisher offers for programmatic access. A condition the publisher states
is recorded here verbatim rather than paraphrased. A source that refuses us is
recorded as refusing us, and the refusal is the result — nothing here is routed
around.

## Provenance

Measured on 12 September 2026, by TASK 021a, from the Sponsor's machine.

**From this machine, never from a cloud environment.** The PO's earlier probes
from a datacenter address were refused at the edge by Jooble (HTTP 403 on an
otherwise valid API call) and by Adzuna's country sites. Every figure below was
taken from the same machine the product runs on, which is the correct
environment rather than a workaround.

Two groups of facts are recorded here. The ones marked **(PO)** were
established by the Product Owner before this task and were deliberately not
re-measured. Everything else was measured by this task and can be reproduced
from the saved raw responses.

The main TASK 021a brief was not available to the session that wrote this file;
only its addendum was. Requirements 1 and 2 of that brief are therefore not
knowingly addressed, and the structure of this document is this session's
choice rather than the PO's. Requirement 3, EURES, is addressed in full below.

## How a posting was counted

The profile is the one TASK 022's acceptance criterion names and the one stored
in the database: a Portuguese engineer in Braga, mid to senior, working in
Angular and .NET, targeting Portugal and Spain, **not willing to relocate**.
That last field decides more than any other: a Madrid office counts for no more
than a Berlin one.

Two definitions are reported side by side, because the answer moves between
them and picking one silently would be dishonest.

| | what it means |
|---|---|
| **strict** | the posting's *title* names .NET, C#, or Angular, and the title is an engineering role at mid or senior level |
| **broad** | the title is an engineering role and the technology appears anywhere in the text the source returned |

Strict counts a job advertised as his job. Broad also catches the dominant
Portuguese pattern — "Java Full Stack Developer" whose stack is Java and
Angular — and, less happily, a Python role that lists Angular in a wish list.

A posting then counts only if the work can be done from Braga: it is in
Portugal, or it is remote and not fenced to a region that excludes him. Where
the work happens is read from the location field and the opening of the
posting, never from deep inside the body. Reading whole descriptions put Berlin
offices in the remote column and counted a Go job as Angular work, because a
long free-text body eventually contains almost any word.

A posting that says it is remote and never says from where is counted
separately as **unknown**, and is not added to either total.

## What a discovery run returns today

| source | postings read | strict | broad | unknown fence |
|---|---:|---:|---:|---:|
| RemoteOK | 99 | 0 | 0 | 1 |
| Remotive | 16 | 0 | 5 | 0 |
| Arbeitnow | 1,300 | 0 | 0 | 1 |
| HN Who is hiring | 494 | 1 | 1 | 1 |
| Adzuna, six countries | 600 | 11 | 17 | 14 |
| Jooble, Portugal | 200 | 120 | 174 | 0 |

Deduplicated on the identity the product itself uses — title, company, and the
first part of the location:

| | postings |
|---|---:|
| **deduplicated union, strict** | **97** |
| deduplicated union, broad | 146 |

**The ≥30 bar holds, about threefold on the stricter definition.** It is worth
being exact about what that sentence does and does not say. It holds because of
one source: 85 of the 97 are Jooble's, 11 are Adzuna's, and 1 is HackerNews's.
Remove Jooble and the number is 12, and the bar fails.

The PO's expectation, recorded in the addendum, was that this would land in the
30–59 band or below it. It did not. The figure above is the one measured.

## Tier 0 — keyless, no configuration

These four are the tier the product is supposed to work on out of the box. For
this profile they are close to empty, and two of them are much smaller than
blueprint §10.2 assumes.

### RemoteOK — `https://remoteok.com/api`

Answered HTTP 200 and returned its newest 99 postings, which is all the free
endpoint offers. Nothing in them was a reachable .NET or Angular role.

Its terms travel in the response itself, as the first element of the array:

> "API Terms of Service: Please link back (with follow, and without nofollow!)
> to the URL on Remote OK and mention Remote OK as a source, so we get traffic
> back from your site. If you do not we'll have to suspend API access."

**Verdict: keep, cheap, and expect nothing.** The attribution condition is a
real UI requirement, not a footnote.

### Remotive — `https://remotive.com/api/remote-jobs`

**The blueprint's description of this source is wrong.** §10.2 calls it "broad
remote coverage, EU-friendly". Its free API returned a `total-job-count` of
**16**. That is the entire board it exposes without payment. Five of the
sixteen passed the broad filter and none passed the strict one, and all five
were posted by one staffing agency.

Its legal notice, also returned inside the response:

> "Please do not submit Remotive jobs to third Party websites, including but
> not limited to: Jooble, Neuvoo, Google Jobs, LinkedIn Jobs. Please link back
> to the URL found on Remotive AND mention Remotive as a source... Jobs
> displayed are delayed by 24 hours... We offer a private, paid-for API...
> (starting budget is $5k/mo)... there is absolutely no need to request
> Remotive Job data too frequently... (we advise max. 4 times a day)."

**Verdict: keep, at no more than four requests a day, and correct §10.2.** The
paid tier is out of scope for a personal tool at that price.

### Arbeitnow — `https://www.arbeitnow.com/api/job-board-api`

Paginates at 250 a page. Ten pages, 1,300 of its most recent postings, were
read. 28 named one of his technologies and 25 of those were mid-or-senior
engineering roles — but they are German onsite roles, and **not one was
reachable from Braga**. One said remote without saying from where.

Its terms travel in the response metadata:

> "This is a free public API for jobs, please do not abuse. I would appreciate
> linking back to the site. By using the API, you agree to the terms of service
> present on Arbeitnow.com"

**Verdict: keep — it is honest, free and well-behaved — but it is a German
onsite board, and for this candidate that means zero.** Its value would appear
only if the Sponsor ever became willing to relocate.

### HN "Who is hiring" — `https://hn.algolia.com/api/v1`

The two most recent monthly threads, September and August 2026, were read
through the thread item endpoint: 494 top-level comments, each one company's
posting. One was a reachable .NET role, one more said remote without saying
from where.

Worth recording because it cost this task a false measurement first: querying
`tags=comment` for a technology term returns the **"Who wants to be hired"**
side of the convention — people offering themselves, not companies offering
work. That produced 216 apparent postings, all of them candidates. The thread
has to be found first and its own comments read, which is what
`app/sources/hackernews.py` already does.

**Verdict: keep. Low yield, no quota, no conditions beyond Algolia's public
API.**

## Tier 2 — aggregators with a key

### Adzuna — `https://api.adzuna.com/v1/api/jobs/{country}/search/1`

**Portugal does not exist on this API.** `GET /v1/api/jobs/pt/search/1` returns
HTTP 404 `UNSUPPORTED_COUNTRY` and the error names the supported set: at, au,
be, br, ca, ch, de, es, fr, gb, in, it, mx, nl, nz, pl, sg, us, za.
`adzuna.pt` does not resolve. **(PO)**

Blueprint §10.2 calls Adzuna "a `pt` country endpoint... the single
highest-value integration for a Portuguese user". That claim is false and is
corrected in this commit. OD-2's deferral of the Portuguese national boards
rested on it and is corrected too.

The account is on the Trial Access plan; credentials are in
`JOB_HUNTER_ADZUNA_APP_ID` and `JOB_HUNTER_ADZUNA_APP_KEY`. **(PO)**

Its published terms carry three things the product has to obey:

> "An API user shall label each displayed advert with the phrase 'Jobs by
> Adzuna'... wherein the word 'Jobs' shall be hyperlinked to
> http://www.adzuna.co.uk"

> "25 hits per minute; 250 hits per day; 1000 hits per week; 2500 hits per
> month"

> "The Adzuna API may be used for: 1. Publishing Adzuna ad listings 2.
> Publishing Jobsworth salary estimates 3. Personal research"

The first is a UI requirement for TASK 022, not a nicety. The second is
comfortable: twelve requests answered this whole measurement. The third is
where a personal job-hunting tool sits under "personal research" — close, but
it is the Sponsor's call to make knowingly, not mine to assume.

**Measured, twelve requests, the fifty most recent results of each:**

| country | role | total in 30 days | sampled | relevant | reachable |
|---|---|---:|---:|---:|---:|
| es | angular | 231 | 50 | 38 | 12 |
| es | .net developer | 53 | 50 | 45 | 8 |
| fr | angular | 1,340 | 50 | 38 | 3 |
| fr | .net developer | 459 | 50 | 20 | 1 |
| de | angular | 945 | 50 | 42 | 3 |
| de | .net developer | 133 | 50 | 48 | 4 |
| pl | angular | 565 | 50 | 42 | 1 |
| pl | .net developer | 189 | 50 | 44 | 2 |
| it | angular | 270 | 50 | 31 | 3 |
| it | .net developer | 69 | 50 | 44 | 5 |
| nl | angular | 132 | 50 | 39 | 1 |
| nl | .net developer | 87 | 50 | 46 | 1 |

The totals reproduce the PO's figures to within two postings, which is the
expected drift over a day and is the only reason they are repeated here. **(PO)**

The addendum asked for a better measure of EU-remote yield than the keyword
`remote` can give, and this is it: rather than searching for the word, the
whole result set for the role was read and each posting judged on what it says
about where the work happens. The result is that **the remote share outside
Spain is 2% to 10%**, which is thin but not zero, and that **Spain is where
Adzuna pays for this candidate** — not as a place to move to, but because a
quarter of Spanish Angular postings are explicitly `100% Teletrabajo` or
`Remoto`.

Applying each sample's reachable share to its own 30-day total gives roughly
**64 reachable Spanish postings and 203 across the other five countries** in a
month. Both are estimates and the second is a weak one: it is extrapolated from
shares as low as one posting in fifty, and Adzuna truncates its descriptions in
search results, so remote work that is only mentioned in the body is missed.
Treat 203 as an order of magnitude and not a number.

**Verdict: keep, for Spain first and remote-EU second, with the "Jobs by
Adzuna" label as a build requirement.**

### Jooble — `POST https://pt.jooble.org/api/<key>`

Body is JSON with `keywords` and `location`; each country domain needs its own
key and the Portuguese one is in `JOB_HUNTER_JOOBLE_KEY`. **(PO)**

**The quota is the constraint that shapes everything.** Jooble's own message on
issuing the key states a **default limit of 500 requests**, raised only by
writing to them. The PO has consumed 5. TASK 021a was capped at 10 further
requests and spent **6**, leaving 4 of its allowance unused and roughly 489 of
the lifetime budget. **(PO, for the 500 and the 5.)**

**A stated condition of use, not a suspicion.** `pt.jooble.org/api/about`
presents the API as being for the webmaster of a web portal or search engine
wishing to republish Jooble results on their own site. Job Hunter is a personal
desktop tool and does not republish anything. That framing is recorded here as
a declared condition; resolving it is the Sponsor's decision, not the
Developer's. **(PO)**

**What the six requests bought:**

| keywords | location | page | size | totalCount | relevant | reachable |
|---|---|---:|---:|---:|---:|---:|
| angular | Portugal | 1 | 20 | 1,061 | 18 | 18 |
| angular | Portugal | 1 | 100 | 1,061 | — | — |
| angular | Portugal | 5 | 20 | 1,061 | 17 | 17 |
| .net | Portugal | 1 | 20 | 1,985 | 20 | 19 |
| .net | Portugal | 5 | 20 | 1,985 | 18 | 16 |
| angular | Porto | 1 | 20 | 273 | 18 | 18 |

Four things follow, and each of them changes a decision.

**One request can return a hundred postings, not twenty.** Passing
`ResultOnPage: 100` is honoured. That is the difference between a source that
cannot be used and one that can: a sweep of two queries at a hundred results
each costs two requests, so roughly 240 sweeps remain within the lifetime
budget. Jooble still cannot be a daily source in the way a keyless board can,
but a weekly or twice-weekly sweep is affordable for years. TASK 027's
scheduler must treat it as a periodic sweep with a hard counter, and the
counter must be persisted — a budget kept in memory is a budget that resets
every time the app restarts.

**`totalCount` is not an inventory figure.** 1,061 for "angular" is the size of
a loose match. Page one is twenty Angular roles; page five is mostly Java,
Python, mobile and even security roles that mention the word somewhere in the
body. Relevance survives to page five under the broad definition and collapses
under the strict one. Depth is cheap in requests and expensive in noise.

**The inventory is real, fresh and precisely on-profile.** Of the 100 postings
sampled across the five 20-row pages, 80 were updated within the last two
months and 51 within the current one. They sit in Lisboa, Porto, Braga, Aveiro,
Vila Nova de Gaia, Setúbal and Viana do Castelo — the candidate's own map — and
they are posted by the Portuguese consultancies that actually hire for this
stack: KCS IT, Devoteam, Integer Consulting, Adentis, LUZA Group, Dellent,
agap2IT, Bee Engineering, Inetum, Capgemini.

**A third of it originates on ITJobs.pt.** The `source` field on each posting
names the board it came from:

| origin | share of the 100 sampled |
|---|---:|
| itjobs.pt | 35 |
| manatal.com | 9 |
| ofertas-emprego.net | 9 |
| teamtailor.com | 9 |
| cvwarehouse.com | 7 |
| smartrecruiters.com | 5 |
| jazzhr.com | 4 |
| capgemini.com | 4 |
| workable.com | 3 |
| hays.pt | 3 |
| app.linkedin.com | 3 |
| tideri.com | 3 |
| zoho.com | 2 |
| ofertasdeemprego.pt | 2 |
| boards.greenhouse.io | 1 |
| jobtraffic.co.uk | 1 |

**Verdict: keep, and treat as the single source that decides whether this
product is worth running.** Everything else combined yields 12.

## Tier 3 — Portuguese national boards, and what this does to OD-2

OD-2 deferred ITJobs.pt, Landing.jobs and Net-Empregos on the grounds that
"Adzuna's `pt` endpoint (official API, free tier) goes into TASK 022 and covers
a meaningful slice of the same inventory legitimately". **That endpoint does not
exist.** The premise of the deferral is gone.

What replaces it is better than the premise was. **A third of the Portuguese
inventory measured above reached us through Jooble already, attributed to
ITJobs.pt.** The product can therefore see the most relevant board in the
country without making a single request to it, without reading its terms of
service as a prospective automated client, and without the Sponsor decision
OD-2 requires.

What is *not* established is the arrangement behind that. Jooble's index names
`itjobs.pt` as the origin of those postings; whether that is under an agreement
between the two companies, or on some other basis, was not investigated and is
not asserted here. The relevant fact for this product is narrower and is
solidly established: the postings arrive through an API whose operator issued
us a key, and no request is made to ITJobs.pt.

Nothing here licenses building an ITJobs.pt, Landing.jobs or Net-Empregos
source. The blueprint's rule stands: no Tier 3 source without its ToS read and
a Sponsor decision recorded in this file. The point is that **the decision is no
longer urgent**, where before it was the fallback for a missing endpoint.

A second and quieter finding sits in the same table. Roughly **18% of the
Portuguese inventory originates on ATS boards the product can already read
keylessly and without any quota** — Teamtailor, SmartRecruiters, Workable,
Greenhouse. Those employers belong in the TASK 022 seed table, where they cost
nothing and count against no budget. Reaching them through Jooble spends a
metered request for a posting that was free.

Three of the hundred came from `app.linkedin.com`. The product does not and
will not touch LinkedIn; it is recorded only so that nobody is later surprised
to find a LinkedIn-origin posting in the database, arriving second-hand and
legitimately.

## EURES — out, pending a Sponsor decision

Requirement 3 of the brief was to establish the published basis from Commission
sources first, and to make no request to EURES if there is none. **No request
was made to any EURES endpoint.** What follows comes from documentation only.

Blueprint §10.2 calls EURES "the only genuinely pan-European public source;
highest priority new source for this user". The first half is true. The second
does not survive the terms.

**There is no Commission-published API.** An endpoint at
`https://europa.eu/eures/api` exists and is reachable, and the only
documentation for it is a community project that opens by disclaiming exactly
what would be needed to rely on it:

> "This is an unofficial, community-maintained documentation project. It is not
> affiliated with or endorsed by the European Commission or the EURES network."

and, about the endpoint itself, that it is "not an official API" with "no
guaranteed stability, rate limits, or support", and that "usage is subject to
the EURES portal terms of use".

**Those terms restrict the API to partner organisations.** The Commission's own
"Data protection statement and Specific terms and conditions for the use of the
EURES portal services" states that users may not use web crawling, screen
scraping or any other automated or manual system to extract data from CVs or
job vacancies in order to further process or republish it, and that **only
EURES partner organisations recognised by a EURES National Coordination Office
may extract data using their API or similar technologies**.

Job Hunter is a personal desktop tool and is not a EURES partner organisation.

One caveat, stated because it affects how much weight this should carry: the
wording above was obtained from two independent search-engine extracts of that
Commission page, which agreed. A direct fetch of the page returned a version
that does not contain the section at all, and the separate EURES legal notice
says only "Re-use is authorised, provided that ELA is acknowledged as the
source of the material." The page appears to have changed, or to render its
terms dynamically. **Before any decision is taken on the strength of this
section, the live page should be read in a browser.**

**Verdict: OUT, pending a Sponsor decision, with no request made.** §10.2's
"highest priority new source" is corrected in this commit. If the Sponsor wants
it, the honest route is to ask a EURES National Coordination Office what
partner recognition involves — not to call an endpoint nobody published.

## Permanently rejected

LinkedIn, Indeed, Glassdoor, StepStone, Xing and Workday scraping stay out, for
the reason blueprint §10.2 already gives. Nothing measured here changes that.

## What the Sponsor has to decide

| Question | Why it is his and not the Developer's |
|---|---|
| **Jooble's declared condition of use.** Its API is presented as being for a webmaster republishing Jooble results on their own site. Job Hunter republishes nothing and is one person's desktop tool. | Reading a stated condition as "does not apply to me" is a judgement about his own exposure. |
| **Adzuna's permitted-use list.** It allows "personal research". A personal job hunt is close to that and is not named. | Same. The alternative is to write and ask, which costs an email. |
| **Whether relocating to Spain is on the table.** The stored profile says no. If it changed, Adzuna's Spanish inventory goes from roughly 64 reachable postings a month to roughly 223. | It is his life, and it is the single biggest lever on the numbers in this document. |
| **EURES.** Out until someone asks a National Coordination Office about partner recognition. | It is a relationship to open, not a technical problem to solve. |

## Reproducing these figures

The raw responses are saved, so nothing here needs re-requesting, and the
Jooble ledger records every request this task spent. The measurement scripts
are deliberately **not** committed: they are a one-off harness, they carry
absolute paths from this machine, and the product's own source modules are what
TASK 022 will build and test. What is committed is this document and the
numbers in it.
