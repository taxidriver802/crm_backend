# CRM Team Management — Next Goals Context

## Purpose

This context file captures the next major direction for the CRM project after the successful invite-only onboarding flow. The goal is to expand the existing Users page into a more complete **Team Management / Admin system** without reinventing what already works.

The current foundation is already strong:

* invite-only user creation
* secure invite email flow
* accept-invite onboarding
* role-based permissions
* role editing safeguards
* self-protection rules
* owner/admin access gating

This next phase is about turning that foundation into a more polished, product-like admin experience.

---

## Current State Summary

The CRM already supports:

* owner/admin protected access to user management
* inviting new users by email
* one-time invite links
* email delivery through Resend
* account activation through invite acceptance
* role restrictions and editing safeguards
* protection against unsafe self-edits
* stable behavior across localhost and ngrok

This means the hard authentication and onboarding work is already in place.

---

## Next Major Goal

Expand the current **Users** area into a fuller **Team Management** system.

This should focus on:

* better visibility into user/invite lifecycle
* clearer permission-aware UI
* more complete invite handling
* stronger admin trust and safety features
* eventual workspace/admin expansion

This should feel like a natural extension of the current Users page, not a separate disconnected feature.

---

## Recommended Build Order

### Phase 1 — Polish the Existing Users System

Focus on making the current page more complete and product-like.

#### Additions

* resend invite action
* copy invite link again for invited users
* invited date
* invite expiration date/status
* accepted date or last login date
* search by name/email
* filter by role
* filter by status
* clearer messaging when actions are disabled

#### Goal

Turn the Users page from a working admin utility into a polished operational screen.

---

### Phase 2 — Permission-Aware UI

The backend already enforces permissions, but the frontend should become smarter.

#### Improvements

* admins should only see allowed role options
* owner should see full role options
* hide or disable actions that are not permitted
* explain disabled actions with helper text or tooltips
* make dangerous actions visually distinct

#### Goal

Prevent confusing UI states where users can see options they are not allowed to use.

---

### Phase 3 — Invite Lifecycle Management

Now that invites work, build out the lifecycle around them.

#### Additions

* pending invites section or tab
* resend invite
* revoke invite
* expired invite badge/status
* accepted invite tracking
* invite created date
* invite accepted date
* invite sent by

#### Possible statuses

* invited
* active
* disabled
* expired

#### Goal

Make invite handling a first-class feature instead of a one-time action.

---

### Phase 4 — Audit Trail / Admin Activity Log

Add visibility into important team-management actions.

#### Track events like

* user invited
* invite resent
* invite revoked
* invite accepted
* role changed
* user disabled
* user re-enabled
* user deleted
* ownership transferred

#### Suggested fields

* actor user
* target user
* action type
* old value
* new value
* timestamp

#### Goal

Improve trust, accountability, and debugging for admin actions.

---

### Phase 5 — Broader Admin / Workspace Settings

Once team management is polished, the same area can grow into a broader admin section.

#### Possible sections

* Team

  * users
  * invites
  * roles
* Workspace

  * business name
  * branding
  * logo
  * email sender name
* Security

  * ownership transfer
  * session management
  * password reset support
* Integrations

  * email provider
  * ABC Supply integration
  * future CRM integrations

#### Goal

Evolve from simple user management into a true admin/workspace area.

---

### Phase 6 — Owner-Grade Safeguards

Add stronger protection around high-privilege actions.

#### Safeguards

* prevent deleting the last owner
* prevent demoting the last owner
* ownership transfer flow
* stronger confirmation for owner promotion
* optional password re-entry for sensitive actions
* optional single-owner enforcement

#### Goal

Make role management safer and closer to production-grade behavior.

---

## Suggested Immediate Next Steps

The strongest next steps, in order, are:

1. **Invite lifecycle improvements**

   * resend invite
   * show invite expiry
   * show invited/accepted dates
   * show invite state clearly

2. **Permission-aware frontend controls**

   * render only allowed role options
   * hide impossible actions
   * improve disabled-state messaging

3. **Search/filter improvements**

   * name/email search
   * role/status filtering

4. **Simple audit log**

   * track core admin/team actions first

These give the biggest UX and product upgrade without exploding scope.

---

## Product Direction Reminder

The goal is **not** to rebuild the Users page from scratch.

The goal is to:

* preserve the strong role/auth/invite foundation
* add visibility and clarity
* support real admin workflows
* make the experience feel intentional and trustworthy

This should result in a more complete **Team Management dashboard** rather than just a users table.

---

## Vision for the Evolved Page

The current page is a functional users table.

The evolved version could become:

* top summary stats
* invite/new user actions
* filters and search
* active users table
* invited users table or tab
* user detail actions
* recent admin activity
* clearer status badges and lifecycle handling

This would make the CRM feel more like a real SaaS admin surface.

---

## Working Principle Going Forward

When building this phase, prioritize:

1. clarity
2. safety
3. product polish
4. admin usefulness
5. extensibility for future workspace settings

Avoid adding complexity unless it directly improves real admin workflows.

---

## Recommended Focus for the Next Session

Begin with:

* resend invite
* invite expiration visibility
* permission-aware role dropdowns
* role/status filters

That is the most natural and high-value continuation from the current state.
