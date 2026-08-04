# Privacy notice

_Last updated: 3 August 2026._

This deployment of Corro is operated by **{{controller}}**, based in {{jurisdiction}}. You can
contact the operator at **{{contact}}**.

For data-protection purposes, {{controller}} is the _controller_: the person or organisation that
decides how the data described below is used. Corro is the software; this notice concerns this
particular deployment of it.

## Playing without an account

You do not need an account to play. Corro does not ask an account-less player for an email address
or a real name, but the server still processes the data needed to run a table and let players return
to it.

When you create or join a table, the server stores:

- The **player name you choose**, internal table and player identifiers, your piece or seat choices,
  and timestamps. Your chosen name does not have to be your real one.
- A secret credential for your seat and a re-entry code. These prove that the seat is yours and are
  not shown to the other players.
- The table settings, game actions, current state and results.
- The 200 most recent text-chat messages, if the table uses chat.
- A custom game package, if the host uploads one for the table.

This information is used to run the game, enforce its rules and restore the table after a
reconnection. The other people at the table can see your chosen name, game actions and chat
messages. The controller and authorised server administrators can access the stored table record;
text chat is not end-to-end encrypted, so the server can access its contents. Do not put information
in a player name, message or uploaded package that you do not want those people to see.

Like any online service, the server and its hosting systems also process technical connection data,
such as your IP address, request times, requested routes and basic browser or network information.
Operational logs may include table, player or account identifiers and player names. This data is
used to secure, operate and diagnose the service, not for advertising or profiling.

## If you sign in

Signing in is optional. It creates an account that stores:

- An internal account identifier and an editable account display name, initially taken from the
  profile supplied by your sign-in provider.
- The email address reported by the provider, when one is available. It is shown in your account
  settings so you can distinguish sign-in methods; Corro does not use it to match accounts.
- For each linked sign-in method, the provider name, the opaque identifier that provider assigns to
  you, the email address it reported and the date it was linked.
- The dates on which the account was created and last used to sign in.

Corro never receives your provider password and does not retain the provider's access token. An
account is matched only by the provider and its opaque identifier, never by email address. Two
providers can report the same email address for different people, so using a second provider may
initially create a separate account. Accounts are joined only after you deliberately prove that you
control both sign-in methods.

When you take a seat while signed in, the table records your internal account identifier. If you
sign in after playing without an account, your browser can associate the seats whose credentials it
already holds with that account. This is what lets those tables appear on another signed-in device.

## Your public name, and being seen online

An account can hold a **public name** — a handle such as `@kastwey` — that you choose yourself. It
is optional: you do not need one to play, and nothing asks for one when you sign in. It is stored
alongside your account, together with the date you last changed it, so a handle stays stable for
thirty days at a time.

Separately, you choose who may see you in the **list of players currently connected**:
**nobody**, **only your friends** (the starting choice, which shows you to nobody until you accept
someone), or **everyone**. "Nobody" means nobody, your friends included.

While somebody can see you, the server publishes to them:

- Your **handle**. Never your account display name, which usually comes from your sign-in provider
  and is often your real name — that is not published by this list at all.
- A coarse indication of what you are doing: in the lobby, at a table, or playing. It never names
  the table or the game you are in.

Anybody connected who you cannot see is **counted** for you, as a number and nothing else: no name,
no activity, no way to tell one of them from another. Be aware of what a count can still imply — in
a quiet moment, "1 player you cannot see" narrows the field. It is published anyway because a room
that reports nobody while it is full reads as broken, and this site already shows the number of
players connected in its footer. If you would rather not be counted at all, the only way is not to
be connected.

Sitting at a table is separate from all of this. Everybody at a table sees the **public name** of
anybody there who has one, whatever their setting above says: that setting decides who finds you
among strangers, and the people you dealt into a game are not strangers. Your account display name
is still not shown there either. If you would rather not be recognised at a table, do not set a
public name — playing has never required one.

A handle you stop using is not immediately given to somebody else, so nobody can take a name your
friends know and appear as you.

An account also carries the **unlock codes** for hidden boards you have entered, so a board unlocked
on one device is there on the next. They are stored as typed, normalized; they are not credentials —
the code is the same string you would type again, and holding it reveals nothing but a board in a
list. Your browser keeps its own copy as well, so unlocking still works with no account at all.

## Friend requests

From the list of players connected you can ask somebody to be friends. Asking stores one record of
the relationship between the two accounts: which of you asked, whether it is waiting, agreed or
refused, and when. Nothing else about you travels with it.

You can only be asked by name if you have a public name AND asked to be listed, so being findable
stays a decision you make. The server answers the same way to an unknown name and to somebody who
chose not to be listed, so the request page cannot be used to test which names exist.

Two things about refusing are worth stating plainly, because they are choices rather than
consequences of how it was built:

- **A refusal is remembered.** The record survives it, so the same person cannot ask you again. Were
  it simply erased, "no" would mean "not this evening" and your only real escape would be to stop
  being listed at all.
- **A refusal is not reported.** The person who asked continues to see that they asked, and is never
  told what you decided. Nor can they take a request back — a button that worked before an answer
  and failed afterwards would announce your decision by failing.

You can end a friendship at any time, from either side; it erases the record, and either of you may
ask again afterwards. Deleting your account erases every one of these records, including from the
lists of people who were friends with you.

## Private messages

You can write to other players from the lobby by naming them with "@" and their public name. Who
may write to YOU is your own choice, in the same three steps: nobody, only your friends (the
starting choice), or anyone.

**Nothing is stored on the server.** A message is handed to whatever connections the recipient has
open and then forgotten: there is no mailbox, no history, and no record that two people ever wrote
to each other. Somebody who is not connected does not receive it, and you are told so at once. What
you have said and been told this session is kept by your own browser, in the tab, and goes when the
tab closes.

Every reason a message fails — no such name, not connected, their settings refuse you — is reported
to the sender with the SAME words, so this cannot be used to learn who exists, who is around, or who
has quietly shut somebody out. And nothing about an undelivered message is ever shown to the person
it was addressed to.

## Cookies and data kept in your browser

Corro itself uses these first-party cookies:

- `corro_language` stores your language choice for one year.
- `corro.session` contains an encrypted sign-in credential. It expires after a sliding period set
  by the operator — 30 days by default — and active use may renew it.
- `corro.external` temporarily carries the result of a Google or Microsoft sign-in. It expires
  after at most five minutes and is normally removed as soon as sign-in finishes.

The two sign-in cookies are `HttpOnly` and are necessary only if you choose to use an account.
Corro does not set advertising or analytics cookies.

The browser's local storage keeps:

- A list of tables this browser has joined, including their table and player identifiers, seat
  credentials, re-entry codes and chosen player names. Entries older than seven days are removed
  when the list is next read.
- Local preferences such as the theme, sound settings, per-player voice volumes, selected audio
  devices, hand layout, dismissed notices and package unlock codes.

The app sends saved table identifiers to the server to refresh the list. It sends a seat credential
when reconnecting or, after you sign in, when associating that seat with your account. The other
preferences normally remain in the browser.

Clearing this site's data in your browser removes these local records and cookies. It does **not**
delete an account, a table or a chat history stored on the server.

## Voice chat

If this deployment offers voice chat, joining it is always optional. When you choose to join, your
browser sends your microphone audio through the deployment's voice relay to the other people in the
room. The relay also processes your table-specific player identifier and name, IP address and
connection metadata.

Audio is encrypted on each connection using WebRTC, but it is not end-to-end encrypted between
participants: the relay can access the media. Corro does **not** record or transcribe it. Leaving
voice chat stops your browser from sending audio.

## Why this data is used

The data above is used to:

- Provide the table, chat, account and optional voice features you request.
- Authenticate a seat or account and let its owner reconnect.
- Prevent abuse, protect the service, investigate failures and maintain its reliability.
- Comply with a legal obligation where one applies.

Where the GDPR or similar law applies, processing needed for the table, text-chat, account and
optional voice features rests on performance of the agreement under which the controller provides
the service you request. The voice relay receives audio only after you choose to join, and leaving
stops any further transmission. Proportionate operational logging and abuse prevention rest on the
controller's legitimate interests in security and reliable operation. Processing required by law
rests on the relevant legal obligation.

The player name and technical credentials are required to take a seat. An account, an email address
and voice chat are not required to play. Corro does not sell personal data, use it for advertising,
build advertising profiles or make automated decisions that have legal or similarly significant
effects on you.

## Who receives the data

- **Other players at your table** receive the names, game information, chat and live voice that are
  meant to be shared with them.
- **The sign-in provider you choose**, currently Google or Microsoft when offered, learns that you
  signed in to this site and sends the controller your provider identifier, profile name and, when
  available, email address. That sign-in provider's own privacy policy applies to its processing.
- **The controller's technical service providers** may process data on the controller's behalf.
  These can include hosting, database, operational logging and optional voice-relay providers. The
  providers depend on how this deployment is run; contact **{{contact}}** for their current names,
  processing locations and any international-transfer safeguards.

Data may also be disclosed where the law requires it or where this is necessary to protect the
service and its users.

## How long the data is kept

The host can delete a table, and an empty table may be removed automatically. Where automatic
retention is enabled, tables with no stored updates for the period chosen by the operator are
deleted; that period is 30 days by default. The table's game state, player names, chat and any
uploaded package are deleted with it. If automatic retention is disabled, a table remains until it
is deleted manually or the underlying storage is cleared.

An account remains until you erase it or the controller acts on a valid deletion request.
Operational logs and backups expire according to the periods set by the controller and its service
providers; contact **{{contact}}** for the periods used by this deployment. Sign-in providers keep
their own records under their own policies.

## Erasing an account

You can erase your account at any time from **Your account**. This deletes the account profile,
email addresses and the mappings for every linked sign-in method, and signs the current browser out.
A later sign-in with the same provider creates a new account.

Erasing an account does **not** erase shared table records. Your seat record, chosen player name,
game actions and chat messages remain for the other players until the table itself is deleted. The
seat may retain the former internal account identifier as an orphaned technical reference, but it no
longer resolves to an account or lets the table be recovered through one. Local table credentials
also remain in this browser until you clear the site's data or they expire from the local list.

Copies in backups or security logs may remain until their normal retention period ends, unless the
law requires them to be kept for longer.

## Your rights

Depending on the law that applies, you may have rights to access, correct or erase your personal
data; restrict or object to its use; receive your data in a portable format; and, where processing
is based on consent, withdraw it. These rights are not absolute, particularly where a shared table
also contains other people's data. Write to **{{contact}}**. The controller may need enough
information to locate your records and verify that they are yours.

The controller will respond within the period required by applicable law. Under the GDPR this is
normally one month, although the law permits an extension for a complex request. You may also lodge
a complaint with a competent data-protection authority, including the authority where you live or
work or where you believe an infringement took place.

## Changes to this notice

This notice will be updated when the deployment's data practices change. The date at the top shows
when its text was last revised.
