# Setting up events: RSVPs, requests, and email invitations

This switches on three things on **Family → Family Events**:

1. **RSVP & requests.** Family can RSVP, request a dish, or say what they're
   bringing. Everything lands in Airtable.
2. **Invitations by email.** From the Family Portal, **Send Invitations** emails
   an event to the people you pick, such as grandparents. The email has the
   day's schedule, the menu, and a calendar invite.
3. **Magic links.** Each person's email carries their own link. It opens the
   site straight to the event, with no password, and their name is already
   filled in.

## How it fits together

```
 Site (GitHub Pages, public code)  ──►  Cloudflare Worker  ──►  Airtable  (guests, requests, invite log)
                                         (holds the keys)   ──►  Gmail     (sends the invitations)
```

The site's code is public, so **no key ever goes in the repo**. Every key lives
only in the Worker, as a Cloudflare secret. Event details (date, schedule, menu)
stay in `data/events.json`, and the Worker reads them from the live site.

About 30 minutes, once. Every step works in a phone browser.

> **Just want RSVPs and the live "Who's coming" board?** Skip Step 3 (Gmail)
> and the four `GOOGLE_…`/`MAIL_FROM` secrets. Invitations can go out with the
> event's **Share invitation** / **Copy invitation** buttons instead. Only
> emailing from the portal needs Gmail.

---

## Step 1: Airtable base

> **Done (Nov 19, 2026).** The three tables below were created in **Family
> Website** and tested end to end. Left to do: add the family to **Guests**
> and tick **Active**. Optional: delete the starter fields Airtable put on
> Guests (Assignee, Status, Attachments, Attachment Summary) and its three
> blank rows. Nothing uses them.

Use the base **Family Website**. Its id is the part of the address that starts
with `app`, for example `airtable.com/appXXXXXXXXXXXXXX/…`. Make three tables.
Names must match exactly, capitals included.

**Guests** (rename "Table 1"):

| Field     | Type                | Notes                                         |
|-----------|---------------------|-----------------------------------------------|
| Name      | Single line text    | Primary field                                 |
| Email     | Email               |                                               |
| Household | Single line text    | Groups the list, e.g. "Grandparents"          |
| Groups    | Multiple select     | Optional: Grandparents, Aunts & Uncles, …     |
| Active    | Checkbox            | Only ticked people can be invited or use a link |
| Token     | Single line text    | Leave empty; the Worker fills it in. Clear it to switch someone's link off. |

**Requests**:

| Field       | Type                               |
|-------------|------------------------------------|
| Name        | Single line text (primary)         |
| Event       | Single line text                   |
| Event Title | Single line text                   |
| Type        | Single select: RSVP, Dish request, Bringing |
| Guest       | Link to Guests                     |
| Attending   | Single select: Yes, No, Maybe      |
| Count       | Number (integer)                   |
| Details     | Long text                          |
| Submitted   | Created time                       |

**Invites**:

| Field  | Type                          |
|--------|-------------------------------|
| Event  | Single line text (primary)    |
| Guest  | Link to Guests                |
| Email  | Email                         |
| Sent   | Date, with time               |
| Status | Single line text              |

Add the family to **Guests** and tick **Active**.

## Step 2: Airtable token

Go to airtable.com/create/tokens → **Create token**.

- **Scopes:** `data.records:read` and `data.records:write`.
- **Access:** only the **Family Website** base.

Copy the token straight into Cloudflare in Step 5. **Never paste it into a chat,
email, or the repo.** If one ever is, open the token in Airtable and
**Regenerate** it; the old one stops working at once.

## Step 3: Gmail, to send from your own address

Invitations go out from your own Gmail, through Google's Gmail API. Replies come
back to your inbox. Gmail allows about 500 a day, far more than the family
needs.

1. Go to console.cloud.google.com and make a new project, e.g.
   "McConnell Family".
2. **APIs & Services → Library**: find **Gmail API** and tap **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**. App name: "McConnell Family". Use your Gmail for
     both email fields.
   - On **Audience**, tap **Publish app** to move it to **In production**.
     In "Testing" the sign-in expires every 7 days and invitations would stop.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**.
   - Authorized redirect URI: `https://developers.google.com/oauthplayground`
   - Copy the **Client ID** and **Client secret**.
5. Open developers.google.com/oauthplayground.
   1. Tap the gear, tick **Use your own OAuth credentials**, and paste the
      Client ID and secret.
   2. In **Step 1**, type the scope `https://www.googleapis.com/auth/gmail.send`
      and tap **Authorize APIs**.
   3. Sign in with the Gmail you'll send from. Google warns that the app isn't
      verified. It's your own app: tap **Advanced → Go to McConnell Family**,
      then **Allow**.
   4. **Step 2 → Exchange authorization code for tokens.** Copy the
      **Refresh token**.

The `gmail.send` scope only lets the Worker send mail. It can't read your inbox.

## Step 4: Two passphrase fingerprints

Open `hash.html` on the site (…/McConnellFamilySports/hash.html). Type each
passphrase below and copy the fingerprint it shows.

- **FAMILY_PASSWORD_SHA256:** the site password everyone already uses. It lets
  people without a magic link send requests.
- **ADMIN_PASSWORD_SHA256:** a **new** passphrase that only you and Brandi know.
  It guards **Send Invitations**. Don't reuse the family password: it's written
  in the README, so anyone could find it.

## Step 5: The Worker

1. Go to dash.cloudflare.com → **Workers & Pages → Create → Create Worker**.
   Name it `mcconnell-family-events` and tap **Deploy**.
2. Tap **Edit code**. Replace everything with `events-endpoint/worker.js` from
   this repo, then tap **Deploy**.
3. Go to **Settings → Variables and Secrets** and add each of these.

   **Text:**

   | Name             | Value |
   |------------------|-------|
   | `ALLOWED_ORIGIN` | `https://mcconnellentllc-cloud.github.io` |
   | `SITE_URL`       | `https://mcconnellentllc-cloud.github.io/McConnellFamilySports` |
   | `MAIL_PROVIDER`  | `gmail` |
   | `MAIL_FROM_NAME` | `The McConnell Family` |

   **Secret:**

   | Name                     | Value |
   |--------------------------|-------|
   | `AIRTABLE_TOKEN`         | From Step 2 |
   | `AIRTABLE_BASE_ID`       | The `app…` id from Step 1 |
   | `MAIL_FROM`              | The Gmail address from Step 3 |
   | `GOOGLE_CLIENT_ID`       | From Step 3 |
   | `GOOGLE_CLIENT_SECRET`   | From Step 3 |
   | `GOOGLE_REFRESH_TOKEN`   | From Step 3 |
   | `FAMILY_PASSWORD_SHA256` | From Step 4 |
   | `ADMIN_PASSWORD_SHA256`  | From Step 4 |

4. Tap **Deploy** once more. Copy the Worker's address, which looks like
   `https://mcconnell-family-events.<you>.workers.dev`.

## Step 6: Point the site at it

On GitHub, open `assets/app.js` and find `const EVENTS_ENDPOINT = "";`. Paste
the Worker address between the quotes, then commit. A few minutes later:

- The RSVP & requests form on the event works.
- **Family Portal → Send Invitations** asks for the passphrase from Step 4, then
  shows the guest list.

**Test it:** send yourself an invitation first, open the link on your phone,
and send an RSVP. The RSVP should appear in Airtable's Requests table.

---

## Day to day

- **New event:** add it to `data/events.json` (or ask Claude), with
  `"requests": true`. Then send invitations from the portal.
- **Who's coming:** open the **Requests** table in Airtable. Filter by Event, or
  group by Type.
- **Who's been invited:** look at the **Invites** table, which records every
  send and its status.
- **Switch off someone's link:** clear their **Token**, or untick **Active**.
- **Lost phone or leaked link:** clear that person's Token. Their next
  invitation carries a new link.

## Notes

- Magic links don't expire on their own, so grandparents can keep one email and
  use it all season. Clearing the Token turns a link off.
- Using a magic link only opens the site and the request form. It never reveals
  the guest list, and nobody can send invitations without the parents'
  passphrase.
- If the family moves its email to Microsoft 365 later, set `MAIL_PROVIDER` to
  `microsoft` and add `TENANT_ID`, `CLIENT_ID` and `CLIENT_SECRET` (an app with
  the **Mail.Send** application permission). Nothing else changes.
