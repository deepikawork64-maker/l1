import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import type {
  BookingAllocation,
  Invitee,
  ResponseChannel,
  ResponseLog,
  ResponseStatus,
  VipTier,
} from './src/types/event.ts';
import {
  applyResponseToInvitee,
  computeDashboardMetrics,
  generateNextInviteeId,
  loadDatabase,
  normalizeCategory,
  recomputeDuplicateFlags,
  saveDatabase,
  findInviteeMatch,
  upsertLogisticsForInvitee,
} from './server/store.ts';
import { createEmptyDatabase } from './server/seedData.ts';
import {
  classifyEmailResponseWithGemini,
  normalizeFormSubmissionWithGemini,
} from './server/aiClassifier.ts';

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function extractGmailBody(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    const plain = payload.parts.find((p: any) => p.mimeType === 'text/plain' && p.body?.data);
    if (plain) return decodeBase64Url(plain.body.data);
    for (const part of payload.parts) {
      const nested = extractGmailBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function parseEmailAddressHeader(raw: string): { name: string; email: string } {
  const match = raw.match(/^(?:"?([^"]*)"?\s*)?<?([^\s<>]+@[^\s<>]+)>?$/);
  if (match) {
    return { name: (match[1] || '').trim(), email: (match[2] || '').trim() };
  }
  return { name: '', email: raw.trim() };
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseEmlPart(rawPart: string): { contentType: string; body: string } {
  const sep = rawPart.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n';
  const splitIdx = rawPart.indexOf(sep);
  if (splitIdx === -1) return { contentType: 'text/plain', body: rawPart.trim() };

  const headerText = rawPart.slice(0, splitIdx).replace(/\r?\n[ \t]+/g, ' ');
  let body = rawPart.slice(splitIdx + sep.length);

  const ctMatch = headerText.match(/^Content-Type:\s*([^\r\n]+)/im);
  const cteMatch = headerText.match(/^Content-Transfer-Encoding:\s*([^\r\n]+)/im);
  const contentType = (ctMatch?.[1] || 'text/plain').toLowerCase();
  const encoding = (cteMatch?.[1] || '').trim().toLowerCase();

  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const sections = body.split(`--${boundary}`);
    let htmlFallback = '';
    for (const sec of sections) {
      if (!sec.trim() || sec.trim() === '--') continue;
      const parsed = parseEmlPart(sec.replace(/^\r?\n/, ''));
      if (parsed.contentType.includes('text/plain') && parsed.body) return parsed;
      if (parsed.contentType.includes('text/html') && parsed.body && !htmlFallback) {
        htmlFallback = stripHtmlTags(parsed.body);
      }
    }
    return { contentType: 'text/plain', body: htmlFallback };
  }

  if (encoding === 'base64') {
    try {
      body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf-8');
    } catch {
      // keep raw
    }
  } else if (encoding === 'quoted-printable') {
    body = decodeQuotedPrintable(body);
  }

  if (contentType.includes('text/html')) {
    return { contentType: 'text/plain', body: stripHtmlTags(body) };
  }
  return { contentType, body: body.trim() };
}

function parseEmlContent(rawEml: string): {
  senderName: string;
  senderEmail: string;
  subject: string;
  messageId: string | null;
  body: string;
} {
  const sep = rawEml.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n';
  const splitIdx = rawEml.indexOf(sep);
  const headerText = (splitIdx === -1 ? rawEml : rawEml.slice(0, splitIdx)).replace(/\r?\n[ \t]+/g, ' ');
  const fromRaw = headerText.match(/^From:\s*([^\r\n]+)/im)?.[1] || '';
  const subject = headerText.match(/^Subject:\s*([^\r\n]+)/im)?.[1]?.trim() || '(No Subject)';
  const messageId = headerText.match(/^Message-ID:\s*([^\r\n]+)/im)?.[1]?.trim() || null;
  const { name: senderName, email: senderEmail } = parseEmailAddressHeader(fromRaw);
  const parsedBody = parseEmlPart(rawEml);
  return {
    senderName,
    senderEmail,
    subject,
    messageId,
    body: parsedBody.body,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // --- Core Database & State Endpoints ---
  app.get('/api/state', (_req, res) => {
    const db = loadDatabase();
    res.json({
      db,
      metrics: computeDashboardMetrics(db),
    });
  });

  app.patch('/api/event-meta', (req, res) => {
    const db = loadDatabase();
    const { eventName, eventDates, venue, city } = req.body ?? {};
    if (typeof eventName === 'string' && eventName.trim()) db.meta.eventName = eventName.trim();
    if (typeof eventDates === 'string') db.meta.eventDates = eventDates.trim();
    if (typeof venue === 'string') db.meta.venue = venue.trim();
    if (typeof city === 'string') db.meta.city = city.trim();
    saveDatabase(db);
    res.json({ db, metrics: computeDashboardMetrics(db) });
  });

  app.post('/api/reset-seed', (_req, res) => {
    const nextDb = createEmptyDatabase();
    saveDatabase(nextDb);
    res.json({ db: nextDb, metrics: computeDashboardMetrics(nextDb) });
  });

  // --- Invitee CRUD & Master Database ---
  app.post('/api/invitees', (req, res) => {
    const db = loadDatabase();
    const b = req.body ?? {};
    const now = new Date().toISOString();
    const inviteeId =
      typeof b.inviteeId === 'string' && b.inviteeId.trim()
        ? b.inviteeId.trim().toUpperCase()
        : generateNextInviteeId(db.invitees);

    if (db.invitees.some((i) => i.inviteeId.toUpperCase() === inviteeId)) {
      res.status(409).json({ error: `Invitee ID ${inviteeId} already exists.` });
      return;
    }

    const rsvpStatus: ResponseStatus = b.rsvpStatus || 'Awaiting Response';
    const newInvitee: Invitee = {
      inviteeId,
      name: String(b.name || '').trim(),
      designation: String(b.designation || '').trim(),
      organisation: String(b.organisation || '').trim(),
      category: normalizeCategory(String(b.category || 'Delegate')),
      email: String(b.email || '').trim(),
      phone: String(b.phone || '').trim(),
      city: String(b.city || '').trim(),
      vipTier: (b.vipTier as VipTier) || 'Standard',
      invitationSent: Boolean(b.invitationSent ?? true),
      invitationSentDate: b.invitationSentDate || now.slice(0, 10),
      rsvpStatus,
      confirmedParticipation: rsvpStatus === 'Confirmation Received',
      lastResponseAt: rsvpStatus === 'Awaiting Response' || rsvpStatus === 'No Response' ? null : now,
      lastResponseChannel: rsvpStatus === 'Awaiting Response' || rsvpStatus === 'No Response' ? null : 'Direct Entry',
      responseCount: rsvpStatus === 'Awaiting Response' || rsvpStatus === 'No Response' ? 0 : 1,
      duplicateOfId: null,
      duplicateReason: null,
      notes: String(b.notes || '').trim(),
      createdAt: now,
      updatedAt: now,
    };

    if (!newInvitee.name || !newInvitee.email) {
      res.status(400).json({ error: 'Name and Email are required.' });
      return;
    }

    db.invitees.push(newInvitee);
    if (newInvitee.confirmedParticipation) {
      upsertLogisticsForInvitee(db, newInvitee.inviteeId, {}, 'Direct Entry');
    }
    recomputeDuplicateFlags(db);
    saveDatabase(db);
    res.status(201).json({ invitee: newInvitee, db, metrics: computeDashboardMetrics(db) });
  });

  app.patch('/api/invitees/:inviteeId', (req, res) => {
    const db = loadDatabase();
    const inv = db.invitees.find((i) => i.inviteeId === req.params.inviteeId);
    if (!inv) {
      res.status(404).json({ error: 'Invitee not found.' });
      return;
    }
    const b = req.body ?? {};
    const prevConfirmed = inv.confirmedParticipation;

    if (b.name !== undefined) inv.name = String(b.name).trim();
    if (b.designation !== undefined) inv.designation = String(b.designation).trim();
    if (b.organisation !== undefined) inv.organisation = String(b.organisation).trim();
    if (b.category !== undefined) inv.category = normalizeCategory(String(b.category));
    if (b.email !== undefined) inv.email = String(b.email).trim();
    if (b.phone !== undefined) inv.phone = String(b.phone).trim();
    if (b.city !== undefined) inv.city = String(b.city).trim();
    if (b.vipTier !== undefined) inv.vipTier = b.vipTier as VipTier;
    if (b.invitationSent !== undefined) inv.invitationSent = Boolean(b.invitationSent);
    if (b.invitationSentDate !== undefined) inv.invitationSentDate = b.invitationSentDate;
    if (b.notes !== undefined) inv.notes = String(b.notes).trim();

    if (b.rsvpStatus !== undefined && b.rsvpStatus !== inv.rsvpStatus) {
      applyResponseToInvitee(db, inv, b.rsvpStatus as ResponseStatus, 'Direct Entry', new Date().toISOString());
    } else if (prevConfirmed !== inv.confirmedParticipation) {
      inv.updatedAt = new Date().toISOString();
    } else {
      inv.updatedAt = new Date().toISOString();
    }

    recomputeDuplicateFlags(db);
    saveDatabase(db);
    res.json({ invitee: inv, db, metrics: computeDashboardMetrics(db) });
  });

  app.delete('/api/invitees/:inviteeId', (req, res) => {
    const db = loadDatabase();
    const id = req.params.inviteeId;
    db.invitees = db.invitees.filter((i) => i.inviteeId !== id);
    delete db.logistics[id];
    db.bookings = db.bookings.filter((b) => b.inviteeId !== id);
    db.responseLogs = db.responseLogs.map((r) => (r.inviteeId === id ? { ...r, inviteeId: null } : r));
    recomputeDuplicateFlags(db);
    saveDatabase(db);
    res.json({ db, metrics: computeDashboardMetrics(db) });
  });

  // --- Bulk Import (Excel / CSV / Google Sheets normalized rows) ---
  app.post('/api/invitees/import', (req, res) => {
    const db = loadDatabase();
    const { rows, channel = 'Excel Import', mode = 'merge' } = req.body ?? {};
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'No rows provided for import.' });
      return;
    }

    const now = new Date().toISOString();
    let createdCount = 0;
    let updatedCount = 0;
    let duplicateFlaggedCount = 0;

    for (const row of rows) {
      const name = String(row.name || row.Name || row['Full Name'] || '').trim();
      const email = String(row.email || row.Email || row['Email ID'] || '').trim();
      const phone = String(row.phone || row.Phone || row.Mobile || row.Contact || '').trim();
      const explicitId = String(row.inviteeId || row['Invitee ID'] || row.ID || '').trim().toUpperCase();
      if (!name && !email) continue;

      const existing = findInviteeMatch(db, {
        inviteeId: explicitId || null,
        email: email || null,
        phone: phone || null,
        name: name || null,
      });

      if (existing && mode === 'merge') {
        if (row.designation) existing.designation = String(row.designation).trim();
        if (row.organisation) existing.organisation = String(row.organisation).trim();
        if (row.category) existing.category = normalizeCategory(String(row.category));
        if (row.city) existing.city = String(row.city).trim();
        if (row.rsvpStatus) {
          applyResponseToInvitee(
            db,
            existing,
            row.rsvpStatus as ResponseStatus,
            channel as ResponseChannel,
            now
          );
        }
        existing.updatedAt = now;
        updatedCount++;

        if (row.arrivalDate || row.hotelCheckIn || row.travelMode) {
          upsertLogisticsForInvitee(
            db,
            existing.inviteeId,
            {
              arrivalDate: row.arrivalDate || '',
              arrivalTime: row.arrivalTime || '',
              departureDate: row.departureDate || '',
              departureTime: row.departureTime || '',
              travelMode: row.travelMode || '',
              carrierDetails: row.carrierDetails || '',
              accommodationRequired: Boolean(row.accommodationRequired),
              hotelCheckIn: row.hotelCheckIn || '',
              hotelCheckOut: row.hotelCheckOut || '',
              specialRequirements: row.specialRequirements || '',
            },
            channel as ResponseChannel
          );
        }
      } else {
        const newId =
          explicitId && !db.invitees.some((i) => i.inviteeId === explicitId)
            ? explicitId
            : generateNextInviteeId(db.invitees);
        const rsvpStatus: ResponseStatus = (row.rsvpStatus as ResponseStatus) || 'Awaiting Response';
        const inv: Invitee = {
          inviteeId: newId,
          name: name || email,
          designation: String(row.designation || '').trim(),
          organisation: String(row.organisation || '').trim(),
          category: normalizeCategory(String(row.category || 'Delegate')),
          email,
          phone,
          city: String(row.city || '').trim(),
          vipTier: (row.vipTier as VipTier) || 'Standard',
          invitationSent: row.invitationSent !== undefined ? Boolean(row.invitationSent) : true,
          invitationSentDate: row.invitationSentDate || now.slice(0, 10),
          rsvpStatus,
          confirmedParticipation: rsvpStatus === 'Confirmation Received',
          lastResponseAt: rsvpStatus === 'Awaiting Response' ? null : now,
          lastResponseChannel: rsvpStatus === 'Awaiting Response' ? null : (channel as ResponseChannel),
          responseCount: rsvpStatus === 'Awaiting Response' ? 0 : 1,
          duplicateOfId: null,
          duplicateReason: null,
          notes: String(row.notes || `Imported via ${channel}`).trim(),
          createdAt: now,
          updatedAt: now,
        };
        db.invitees.push(inv);
        createdCount++;
        if (existing) duplicateFlaggedCount++;
      }
    }

    recomputeDuplicateFlags(db);
    db.meta.lastSyncedAt = now;
    saveDatabase(db);
    res.json({
      summary: { createdCount, updatedCount, duplicateFlaggedCount },
      db,
      metrics: computeDashboardMetrics(db),
    });
  });

  // --- Merge Duplicate Record into Canonical Invitee ID ---
  app.post('/api/invitees/merge-duplicate', (req, res) => {
    const db = loadDatabase();
    const { duplicateId, targetId } = req.body ?? {};
    const dupIdx = db.invitees.findIndex((i) => i.inviteeId === duplicateId);
    const target = db.invitees.find((i) => i.inviteeId === targetId);
    if (dupIdx === -1 || !target) {
      res.status(404).json({ error: 'Duplicate or target Invitee ID not found.' });
      return;
    }
    const dup = db.invitees[dupIdx];
    target.phone = target.phone || dup.phone;
    target.designation = target.designation || dup.designation;
    target.city = target.city || dup.city;
    target.notes = [target.notes, `Merged duplicate ${dup.inviteeId}`].filter(Boolean).join(' · ');
    target.responseCount = (target.responseCount || 0) + (dup.responseCount || 0);
    target.updatedAt = new Date().toISOString();

    for (const log of db.responseLogs) {
      if (log.inviteeId === duplicateId) log.inviteeId = targetId;
    }
    for (const bkg of db.bookings) {
      if (bkg.inviteeId === duplicateId) bkg.inviteeId = targetId;
    }
    if (db.logistics[duplicateId] && !db.logistics[targetId]) {
      db.logistics[targetId] = { ...db.logistics[duplicateId], inviteeId: targetId };
    }
    delete db.logistics[duplicateId];
    db.invitees.splice(dupIdx, 1);

    recomputeDuplicateFlags(db);
    saveDatabase(db);
    res.json({ db, metrics: computeDashboardMetrics(db) });
  });

  // --- Email / Response Analysis via Server-Side Gemini API ---
  app.post('/api/responses/analyze-email', async (req, res) => {
    try {
      const db = loadDatabase();
      const { senderName = '', senderEmail = '', subject = '', body = '', inviteeIdHint = '' } = req.body ?? {};
      if (!body.trim()) {
        res.status(400).json({ error: 'Email content is required for analysis.' });
        return;
      }

      const aiResult = await classifyEmailResponseWithGemini({
        senderName,
        senderEmail,
        subject,
        body,
        eventContext: `${db.meta.eventName} (${db.meta.eventDates}, ${db.meta.venue})`,
      });

      const matchedInvitee = findInviteeMatch(db, {
        inviteeId: inviteeIdHint || aiResult.matchedInviteeIdHint,
        email: senderEmail || aiResult.originalSenderEmail,
        name: senderName || aiResult.originalSenderName,
      }) || findInviteeMatch(db, {
        email: aiResult.originalSenderEmail,
        name: aiResult.originalSenderName,
      });

      const now = new Date().toISOString();
      const shouldAutoApply =
        Boolean(matchedInvitee) &&
        aiResult.confidence >= 85 &&
        (aiResult.detectedStatus === 'Confirmation Received' || aiResult.detectedStatus === 'Regret Received');

      const logEntry: ResponseLog = {
        id: `RSP-${Date.now().toString().slice(-6)}`,
        inviteeId: matchedInvitee?.inviteeId ?? null,
        senderName: senderName || matchedInvitee?.name || 'Unknown Sender',
        senderEmail,
        channel: 'Email',
        subject: subject || '(No Subject)',
        rawContent: body,
        detectedStatus: shouldAutoApply ? aiResult.detectedStatus : 'Response Pending Verification',
        confidence: aiResult.confidence,
        aiRationale: aiResult.aiRationale,
        extractedLogisticsSummary: aiResult.extractedLogistics?.summary || null,
        verificationState: shouldAutoApply ? 'Auto-Applied' : 'Needs Verification',
        externalMessageId: null,
        receivedAt: now,
      };

      db.responseLogs.unshift(logEntry);

      if (matchedInvitee) {
        if (shouldAutoApply) {
          applyResponseToInvitee(db, matchedInvitee, aiResult.detectedStatus, 'Email', now);
          const ext = aiResult.extractedLogistics;
          if (ext && (ext.arrivalDate || ext.carrierDetails || ext.hotelCheckIn || ext.specialRequirements)) {
            upsertLogisticsForInvitee(
              db,
              matchedInvitee.inviteeId,
              {
                arrivalDate: ext.arrivalDate || undefined,
                arrivalTime: ext.arrivalTime || undefined,
                departureDate: ext.departureDate || undefined,
                departureTime: ext.departureTime || undefined,
                travelMode: ext.travelMode || undefined,
                carrierDetails: ext.carrierDetails || undefined,
                accommodationRequired: ext.accommodationRequired ?? undefined,
                hotelCheckIn: ext.hotelCheckIn || undefined,
                hotelCheckOut: ext.hotelCheckOut || undefined,
                airportPickupRequired: ext.airportPickupRequired ?? undefined,
                airportDropRequired: ext.airportDropRequired ?? undefined,
                specialRequirements: ext.specialRequirements || undefined,
              },
              'Email'
            );
          }
        } else {
          applyResponseToInvitee(db, matchedInvitee, 'Response Pending Verification', 'Email', now);
        }
      }

      saveDatabase(db);
      res.json({ logEntry, aiResult, matchedInvitee: matchedInvitee ?? null, db, metrics: computeDashboardMetrics(db) });
    } catch (err: any) {
      console.error('Email classification error:', err);
      res.status(500).json({ error: err?.message || 'Failed to analyze email response.' });
    }
  });

  // --- Batch .EML File Import (No Mailbox Password Required — Ideal for gov.in / NIC Mail) ---
  app.post('/api/responses/import-eml', async (req, res) => {
    try {
      const db = loadDatabase();
      const { files } = req.body ?? {};
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: 'No .eml files provided.' });
        return;
      }

      const existingExtIds = new Set(db.responseLogs.map((r) => r.externalMessageId).filter(Boolean));
      let importedCount = 0;
      let skippedCount = 0;

      for (const file of files.slice(0, 25)) {
        const parsed = parseEmlContent(String(file?.content || ''));
        if (!parsed.body.trim()) {
          skippedCount++;
          continue;
        }
        const extKey = parsed.messageId ? `eml:${parsed.messageId}` : null;
        if (extKey && existingExtIds.has(extKey)) {
          skippedCount++;
          continue;
        }

        const aiResult = await classifyEmailResponseWithGemini({
          senderName: parsed.senderName,
          senderEmail: parsed.senderEmail,
          subject: parsed.subject,
          body: parsed.body,
          eventContext: `${db.meta.eventName} (${db.meta.eventDates}, ${db.meta.venue})`,
        });

        const matchedInvitee =
          findInviteeMatch(db, {
            inviteeId: aiResult.matchedInviteeIdHint,
            email: parsed.senderEmail,
            name: parsed.senderName,
          }) ||
          findInviteeMatch(db, {
            email: aiResult.originalSenderEmail,
            name: aiResult.originalSenderName,
          });

        const now = new Date().toISOString();
        const effectiveName = aiResult.originalSenderName || parsed.senderName || matchedInvitee?.name || 'Unknown Sender';
        const effectiveEmail = aiResult.originalSenderEmail || parsed.senderEmail;

        const shouldAutoApply =
          Boolean(matchedInvitee) &&
          aiResult.confidence >= 85 &&
          (aiResult.detectedStatus === 'Confirmation Received' ||
            aiResult.detectedStatus === 'Regret Received');

        db.responseLogs.unshift({
          id: `RSP-${Date.now().toString().slice(-5)}-${importedCount}`,
          inviteeId: matchedInvitee?.inviteeId ?? null,
          senderName: effectiveName,
          senderEmail: effectiveEmail,
          channel: 'Email',
          subject: parsed.subject,
          rawContent: parsed.body.slice(0, 2000),
          detectedStatus: shouldAutoApply ? aiResult.detectedStatus : 'Response Pending Verification',
          confidence: aiResult.confidence,
          aiRationale: aiResult.aiRationale,
          extractedLogisticsSummary: aiResult.extractedLogistics?.summary || null,
          verificationState: shouldAutoApply ? 'Auto-Applied' : 'Needs Verification',
          externalMessageId: extKey,
          receivedAt: now,
        });

        if (matchedInvitee) {
          applyResponseToInvitee(
            db,
            matchedInvitee,
            shouldAutoApply ? aiResult.detectedStatus : 'Response Pending Verification',
            'Email',
            now
          );
          const ext = aiResult.extractedLogistics;
          if (shouldAutoApply && ext && (ext.arrivalDate || ext.carrierDetails || ext.hotelCheckIn || ext.specialRequirements)) {
            upsertLogisticsForInvitee(
              db,
              matchedInvitee.inviteeId,
              {
                arrivalDate: ext.arrivalDate || undefined,
                arrivalTime: ext.arrivalTime || undefined,
                departureDate: ext.departureDate || undefined,
                departureTime: ext.departureTime || undefined,
                travelMode: ext.travelMode || undefined,
                carrierDetails: ext.carrierDetails || undefined,
                accommodationRequired: ext.accommodationRequired ?? undefined,
                hotelCheckIn: ext.hotelCheckIn || undefined,
                hotelCheckOut: ext.hotelCheckOut || undefined,
                airportPickupRequired: ext.airportPickupRequired ?? undefined,
                airportDropRequired: ext.airportDropRequired ?? undefined,
                specialRequirements: ext.specialRequirements || undefined,
              },
              'Email'
            );
          }
        }
        if (extKey) existingExtIds.add(extKey);
        importedCount++;
      }

      db.meta.lastSyncedAt = new Date().toISOString();
      saveDatabase(db);
      res.json({ importedCount, skippedCount, db, metrics: computeDashboardMetrics(db) });
    } catch (err: any) {
      console.error('.eml import error:', err);
      res.status(500).json({ error: err?.message || 'Failed to process .eml files.' });
    }
  });

  // --- Manual Verification Queue Action ---
  app.post('/api/responses/:logId/verify', (req, res) => {
    const db = loadDatabase();
    const log = db.responseLogs.find((l) => l.id === req.params.logId);
    if (!log) {
      res.status(404).json({ error: 'Response log entry not found.' });
      return;
    }
    const { inviteeId, finalStatus, dismiss } = req.body ?? {};
    if (dismiss) {
      log.verificationState = 'Dismissed';
      saveDatabase(db);
      res.json({ db, metrics: computeDashboardMetrics(db) });
      return;
    }

    const targetId = inviteeId || log.inviteeId;
    const inv = db.invitees.find((i) => i.inviteeId === targetId);
    if (!inv) {
      res.status(400).json({ error: 'Please select a valid Invitee ID to link this response.' });
      return;
    }

    const resolvedStatus: ResponseStatus = finalStatus || 'Confirmation Received';
    log.inviteeId = inv.inviteeId;
    log.detectedStatus = resolvedStatus;
    log.verificationState = 'Verified';
    applyResponseToInvitee(db, inv, resolvedStatus, log.channel, log.receivedAt || new Date().toISOString());

    saveDatabase(db);
    res.json({ db, metrics: computeDashboardMetrics(db) });
  });

  // --- Built-in Invitee Self-Service RSVP & Logistics Portal ---
  app.post('/api/portal/submit', (req, res) => {
    const db = loadDatabase();
    const b = req.body ?? {};
    const matched = findInviteeMatch(db, {
      inviteeId: b.inviteeId,
      email: b.email,
      phone: b.phone,
    });
    if (!matched) {
      res.status(404).json({
        error: 'No master invitation record matched that Invitee ID or Email. Please verify your Invitee ID.',
      });
      return;
    }

    const now = new Date().toISOString();
    const status: ResponseStatus =
      b.attending === false ? 'Regret Received' : 'Confirmation Received';

    const logEntry: ResponseLog = {
      id: `RSP-${Date.now().toString().slice(-6)}`,
      inviteeId: matched.inviteeId,
      senderName: matched.name,
      senderEmail: matched.email,
      channel: 'Invitee Portal',
      subject: `Portal RSVP & Logistics Update (${matched.inviteeId})`,
      rawContent: `Attending: ${b.attending !== false ? 'Yes' : 'No'}. Travel: ${b.travelMode || 'N/A'} ${b.carrierDetails || ''}. Arrival: ${b.arrivalDate || ''} ${b.arrivalTime || ''}.`,
      detectedStatus: status,
      confidence: 100,
      aiRationale: `Direct verified submission mapped to canonical ${matched.inviteeId}.`,
      extractedLogisticsSummary:
        status === 'Confirmation Received'
          ? `${b.travelMode || 'Travel'} ${b.arrivalDate || ''} · Hotel: ${b.accommodationRequired ? 'Yes' : 'No'}`
          : null,
      verificationState: 'Auto-Applied',
      externalMessageId: null,
      receivedAt: now,
    };
    db.responseLogs.unshift(logEntry);

    applyResponseToInvitee(db, matched, status, 'Invitee Portal', now);

    if (status === 'Confirmation Received') {
      upsertLogisticsForInvitee(
        db,
        matched.inviteeId,
        {
          arrivalDate: b.arrivalDate || '',
          arrivalTime: b.arrivalTime || '',
          departureDate: b.departureDate || '',
          departureTime: b.departureTime || '',
          travelMode: b.travelMode || '',
          carrierDetails: b.carrierDetails || '',
          accommodationRequired: Boolean(b.accommodationRequired),
          hotelCheckIn: b.hotelCheckIn || '',
          hotelCheckOut: b.hotelCheckOut || '',
          roomTypePreference: b.roomTypePreference || '',
          airportPickupRequired: Boolean(b.airportPickupRequired),
          airportDropRequired: Boolean(b.airportDropRequired),
          localTransportRequired: Boolean(b.localTransportRequired),
          specialRequirements: b.specialRequirements || '',
        },
        'Invitee Portal'
      );
    }

    saveDatabase(db);
    res.json({ invitee: matched, db, metrics: computeDashboardMetrics(db) });
  });

  // --- Logistics Upsert ---
  app.put('/api/logistics/:inviteeId', (req, res) => {
    const db = loadDatabase();
    const inv = db.invitees.find((i) => i.inviteeId === req.params.inviteeId);
    if (!inv) {
      res.status(404).json({ error: 'Invitee not found.' });
      return;
    }
    const record = upsertLogisticsForInvitee(db, inv.inviteeId, req.body ?? {}, 'Direct Entry');
    if (req.body?.clearRevisionFlag) {
      record.revisionFlag = false;
      record.revisionNote = null;
    }
    saveDatabase(db);
    res.json({ logistics: record, db, metrics: computeDashboardMetrics(db) });
  });

  // --- Bookings & Allocations ---
  app.post('/api/bookings', (req, res) => {
    const db = loadDatabase();
    const b = req.body ?? {};
    if (!b.inviteeId || !b.bookingType) {
      res.status(400).json({ error: 'inviteeId and bookingType are required.' });
      return;
    }
    const allocation: BookingAllocation = {
      id: `BKG-${Date.now().toString().slice(-5)}`,
      inviteeId: b.inviteeId,
      bookingType: b.bookingType,
      vendorOrProperty: String(b.vendorOrProperty || '').trim(),
      confirmationRef: String(b.confirmationRef || '').trim(),
      checkInOrDate: String(b.checkInOrDate || '').trim(),
      checkOutOrTime: String(b.checkOutOrTime || '').trim(),
      vehicleOrRoomDetails: String(b.vehicleOrRoomDetails || '').trim(),
      driverOrContact: String(b.driverOrContact || '').trim(),
      status: b.status || 'Pending',
      notes: String(b.notes || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    db.bookings.unshift(allocation);
    saveDatabase(db);
    res.status(201).json({ allocation, db, metrics: computeDashboardMetrics(db) });
  });

  app.patch('/api/bookings/:id', (req, res) => {
    const db = loadDatabase();
    const bkg = db.bookings.find((b) => b.id === req.params.id);
    if (!bkg) {
      res.status(404).json({ error: 'Booking record not found.' });
      return;
    }
    const patch = req.body ?? {};
    Object.assign(bkg, {
      bookingType: patch.bookingType ?? bkg.bookingType,
      vendorOrProperty: patch.vendorOrProperty ?? bkg.vendorOrProperty,
      confirmationRef: patch.confirmationRef ?? bkg.confirmationRef,
      checkInOrDate: patch.checkInOrDate ?? bkg.checkInOrDate,
      checkOutOrTime: patch.checkOutOrTime ?? bkg.checkOutOrTime,
      vehicleOrRoomDetails: patch.vehicleOrRoomDetails ?? bkg.vehicleOrRoomDetails,
      driverOrContact: patch.driverOrContact ?? bkg.driverOrContact,
      status: patch.status ?? bkg.status,
      notes: patch.notes ?? bkg.notes,
      updatedAt: new Date().toISOString(),
    });

    // Clear logistics revision flag if no bookings remain in Revision Required for this invitee
    const remainingRev = db.bookings.some(
      (b) => b.inviteeId === bkg.inviteeId && b.status === 'Revision Required'
    );
    if (!remainingRev && db.logistics[bkg.inviteeId]) {
      db.logistics[bkg.inviteeId].revisionFlag = false;
      db.logistics[bkg.inviteeId].revisionNote = null;
    }

    saveDatabase(db);
    res.json({ allocation: bkg, db, metrics: computeDashboardMetrics(db) });
  });

  app.delete('/api/bookings/:id', (req, res) => {
    const db = loadDatabase();
    db.bookings = db.bookings.filter((b) => b.id !== req.params.id);
    saveDatabase(db);
    res.json({ db, metrics: computeDashboardMetrics(db) });
  });

  app.post('/api/bookings/auto-generate', (_req, res) => {
    const db = loadDatabase();
    const now = new Date().toISOString();
    let created = 0;

    for (const inv of db.invitees) {
      if (inv.duplicateOfId || !inv.confirmedParticipation) continue;
      const logi = db.logistics[inv.inviteeId];
      if (!logi) continue;

      const existingTypes = new Set(
        db.bookings.filter((b) => b.inviteeId === inv.inviteeId && b.status !== 'Cancelled').map((b) => b.bookingType)
      );

      if (logi.accommodationRequired && !existingTypes.has('Hotel Room')) {
        db.bookings.push({
          id: `BKG-${Date.now().toString().slice(-4)}-${created++}`,
          inviteeId: inv.inviteeId,
          bookingType: 'Hotel Room',
          vendorOrProperty: 'Allocation Pending',
          confirmationRef: '',
          checkInOrDate: logi.hotelCheckIn || logi.arrivalDate || '',
          checkOutOrTime: logi.hotelCheckOut || logi.departureDate || '',
          vehicleOrRoomDetails: logi.roomTypePreference || 'Standard King',
          driverOrContact: '',
          status: 'Pending',
          notes: 'Auto-generated from confirmed logistics requirement.',
          updatedAt: now,
        });
      }

      if (logi.airportPickupRequired && !existingTypes.has('Airport/Station Pickup')) {
        db.bookings.push({
          id: `BKG-${Date.now().toString().slice(-4)}-${created++}`,
          inviteeId: inv.inviteeId,
          bookingType: 'Airport/Station Pickup',
          vendorOrProperty: 'Fleet Dispatch Pending',
          confirmationRef: '',
          checkInOrDate: logi.arrivalDate || '',
          checkOutOrTime: logi.arrivalTime || '',
          vehicleOrRoomDetails: inv.vipTier === 'VVIP' ? 'Executive Luxury Sedan' : 'Innova / Sedan',
          driverOrContact: '',
          status: 'Pending',
          notes: logi.carrierDetails ? `Arrival: ${logi.carrierDetails}` : 'Auto-generated pickup requirement.',
          updatedAt: now,
        });
      }

      if (logi.airportDropRequired && !existingTypes.has('Airport/Station Drop')) {
        db.bookings.push({
          id: `BKG-${Date.now().toString().slice(-4)}-${created++}`,
          inviteeId: inv.inviteeId,
          bookingType: 'Airport/Station Drop',
          vendorOrProperty: 'Fleet Dispatch Pending',
          confirmationRef: '',
          checkInOrDate: logi.departureDate || '',
          checkOutOrTime: logi.departureTime || '',
          vehicleOrRoomDetails: inv.vipTier === 'VVIP' ? 'Executive Luxury Sedan' : 'Innova / Sedan',
          driverOrContact: '',
          status: 'Pending',
          notes: 'Auto-generated departure drop requirement.',
          updatedAt: now,
        });
      }

      if (logi.localTransportRequired && !existingTypes.has('Local Vehicle')) {
        db.bookings.push({
          id: `BKG-${Date.now().toString().slice(-4)}-${created++}`,
          inviteeId: inv.inviteeId,
          bookingType: 'Local Vehicle',
          vendorOrProperty: 'Fleet Dispatch Pending',
          confirmationRef: '',
          checkInOrDate: logi.arrivalDate || '',
          checkOutOrTime: 'Full-Day Standby',
          vehicleOrRoomDetails: inv.vipTier === 'VVIP' ? 'Protocol Sedan' : 'Dedicated Cab',
          driverOrContact: '',
          status: 'Pending',
          notes: 'Auto-generated local vehicle requirement.',
          updatedAt: now,
        });
      }
    }

    saveDatabase(db);
    res.json({ created, db, metrics: computeDashboardMetrics(db) });
  });

  // --- REAL Google Workspace API Integration Endpoints (Client Bearer Token) ---
  app.post('/api/workspace/gmail/sync', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Google Workspace access token.' });
        return;
      }

      const { query = 'newer_than:14d', maxResults = 10 } = req.body ?? {};
      const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      listUrl.searchParams.set('q', query);
      listUrl.searchParams.set('maxResults', String(Math.min(Number(maxResults) || 10, 20)));

      const listRes = await fetch(listUrl.toString(), {
        headers: { Authorization: authHeader },
      });
      const listData = await listRes.json();
      if (!listRes.ok) {
        res.status(listRes.status).json({ error: listData?.error?.message || 'Gmail API error' });
        return;
      }

      const messages: Array<{ id: string }> = listData.messages || [];
      const db = loadDatabase();
      const existingExtIds = new Set(db.responseLogs.map((r) => r.externalMessageId).filter(Boolean));
      let syncedCount = 0;
      let skippedCount = 0;

      for (const msgRef of messages) {
        if (existingExtIds.has(msgRef.id)) {
          skippedCount++;
          continue;
        }
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgRef.id)}?format=full`,
          { headers: { Authorization: authHeader } }
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();
        const headers: Array<{ name: string; value: string }> = msgData.payload?.headers || [];
        const fromRaw = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
        const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
        const { name: senderName, email: senderEmail } = parseEmailAddressHeader(fromRaw);
        const body = extractGmailBody(msgData.payload) || msgData.snippet || '';

        const matchedInvitee = findInviteeMatch(db, {
          email: senderEmail,
          name: senderName,
        });

        // Only analyze messages from known invitees or messages mentioning event/invitation/INV-
        const mentionsEvent = /inv-\d{4}-\d+|rsvp|invitation|conclave|summit|confirm|regret/i.test(
          `${subject} ${body}`
        );
        if (!matchedInvitee && !mentionsEvent) {
          skippedCount++;
          continue;
        }

        const aiResult = await classifyEmailResponseWithGemini({
          senderName,
          senderEmail,
          subject,
          body,
          eventContext: `${db.meta.eventName} (${db.meta.eventDates})`,
        });

        const finalInvitee =
          matchedInvitee ||
          findInviteeMatch(db, {
            inviteeId: aiResult.matchedInviteeIdHint,
            email: aiResult.originalSenderEmail || senderEmail,
            name: aiResult.originalSenderName || senderName,
          });

        const now = new Date().toISOString();
        const shouldAutoApply =
          Boolean(finalInvitee) &&
          aiResult.confidence >= 85 &&
          (aiResult.detectedStatus === 'Confirmation Received' ||
            aiResult.detectedStatus === 'Regret Received');

        db.responseLogs.unshift({
          id: `RSP-${Date.now().toString().slice(-5)}-${syncedCount}`,
          inviteeId: finalInvitee?.inviteeId ?? null,
          senderName: senderName || finalInvitee?.name || senderEmail,
          senderEmail,
          channel: 'Email',
          subject,
          rawContent: body.slice(0, 2000),
          detectedStatus: shouldAutoApply ? aiResult.detectedStatus : 'Response Pending Verification',
          confidence: aiResult.confidence,
          aiRationale: aiResult.aiRationale,
          extractedLogisticsSummary: aiResult.extractedLogistics?.summary || null,
          verificationState: shouldAutoApply ? 'Auto-Applied' : 'Needs Verification',
          externalMessageId: msgRef.id,
          receivedAt: now,
        });

        if (finalInvitee) {
          applyResponseToInvitee(
            db,
            finalInvitee,
            shouldAutoApply ? aiResult.detectedStatus : 'Response Pending Verification',
            'Email',
            now
          );
          const ext = aiResult.extractedLogistics;
          if (shouldAutoApply && ext && (ext.arrivalDate || ext.carrierDetails || ext.hotelCheckIn)) {
            upsertLogisticsForInvitee(
              db,
              finalInvitee.inviteeId,
              {
                arrivalDate: ext.arrivalDate || undefined,
                arrivalTime: ext.arrivalTime || undefined,
                departureDate: ext.departureDate || undefined,
                departureTime: ext.departureTime || undefined,
                travelMode: ext.travelMode || undefined,
                carrierDetails: ext.carrierDetails || undefined,
                accommodationRequired: ext.accommodationRequired ?? undefined,
                hotelCheckIn: ext.hotelCheckIn || undefined,
                hotelCheckOut: ext.hotelCheckOut || undefined,
                airportPickupRequired: ext.airportPickupRequired ?? undefined,
                airportDropRequired: ext.airportDropRequired ?? undefined,
                specialRequirements: ext.specialRequirements || undefined,
              },
              'Email'
            );
          }
        }
        syncedCount++;
      }

      db.meta.lastSyncedAt = new Date().toISOString();
      saveDatabase(db);
      res.json({ syncedCount, skippedCount, db, metrics: computeDashboardMetrics(db) });
    } catch (err: any) {
      console.error('Gmail sync error:', err);
      res.status(500).json({ error: err?.message || 'Failed to sync Gmail messages.' });
    }
  });

  app.post('/api/workspace/forms/sync', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Google Workspace access token.' });
        return;
      }
      const { formId } = req.body ?? {};
      if (!formId || typeof formId !== 'string') {
        res.status(400).json({ error: 'Google Form ID is required.' });
        return;
      }
      const safeFormId = encodeURIComponent(formId.trim());
      const [formRes, respRes] = await Promise.all([
        fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}`, {
          headers: { Authorization: authHeader },
        }),
        fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}/responses`, {
          headers: { Authorization: authHeader },
        }),
      ]);

      const formData = await formRes.json();
      const respData = await respRes.json();
      if (!formRes.ok) {
        res.status(formRes.status).json({ error: formData?.error?.message || 'Google Forms API error' });
        return;
      }
      if (!respRes.ok) {
        res.status(respRes.status).json({ error: respData?.error?.message || 'Google Forms Responses API error' });
        return;
      }

      // Build questionId -> title map
      const questionTitles = new Map<string, string>();
      for (const item of formData.items || []) {
        const qId = item.questionItem?.question?.questionId;
        if (qId) questionTitles.set(qId, item.title || qId);
      }

      const db = loadDatabase();
      const existingExtIds = new Set(db.responseLogs.map((r) => r.externalMessageId).filter(Boolean));
      const responses = respData.responses || [];
      let syncedCount = 0;
      let skippedCount = 0;

      for (const formResp of responses) {
        if (existingExtIds.has(formResp.responseId)) {
          skippedCount++;
          continue;
        }
        const qaPairs: Array<{ question: string; answer: string }> = [];
        for (const [qId, ansObj] of Object.entries<any>(formResp.answers || {})) {
          const textAnswers = ansObj?.textAnswers?.answers?.map((a: any) => a.value).join(', ') || '';
          qaPairs.push({ question: questionTitles.get(qId) || qId, answer: textAnswers });
        }

        const mapped = await normalizeFormSubmissionWithGemini({
          formTitle: formData.info?.title || 'Event Form',
          qaPairs,
          respondentEmail: formResp.respondentEmail || null,
        });

        const matched = findInviteeMatch(db, {
          inviteeId: mapped.inviteeIdHint,
          email: mapped.email || formResp.respondentEmail,
          phone: mapped.phone,
          name: mapped.name,
        });

        const now = formResp.lastSubmittedTime || new Date().toISOString();
        db.responseLogs.unshift({
          id: `RSP-${Date.now().toString().slice(-5)}-${syncedCount}`,
          inviteeId: matched?.inviteeId ?? null,
          senderName: mapped.name || matched?.name || 'Form Respondent',
          senderEmail: mapped.email || formResp.respondentEmail || '',
          channel: 'Google Form',
          subject: `${formData.info?.title || 'Google Form'} Submission`,
          rawContent: qaPairs.map((p) => `${p.question}: ${p.answer}`).join('\n'),
          detectedStatus: matched ? mapped.rsvpStatus : 'Response Pending Verification',
          confidence: matched ? 96 : 65,
          aiRationale: matched
            ? `Matched Google Form submission to ${matched.inviteeId}`
            : 'No matching Invitee ID or email in Master Registry; verify and link.',
          extractedLogisticsSummary: mapped.logisticsSummary || null,
          verificationState: matched ? 'Auto-Applied' : 'Needs Verification',
          externalMessageId: formResp.responseId,
          receivedAt: now,
        });

        if (matched) {
          applyResponseToInvitee(db, matched, mapped.rsvpStatus, 'Google Form', now);
          if (mapped.rsvpStatus === 'Confirmation Received') {
            upsertLogisticsForInvitee(
              db,
              matched.inviteeId,
              {
                arrivalDate: mapped.arrivalDate,
                arrivalTime: mapped.arrivalTime,
                departureDate: mapped.departureDate,
                departureTime: mapped.departureTime,
                travelMode: mapped.travelMode,
                carrierDetails: mapped.carrierDetails,
                accommodationRequired: mapped.accommodationRequired,
                hotelCheckIn: mapped.hotelCheckIn,
                hotelCheckOut: mapped.hotelCheckOut,
                roomTypePreference: mapped.roomTypePreference,
                airportPickupRequired: mapped.airportPickupRequired,
                airportDropRequired: mapped.airportDropRequired,
                localTransportRequired: mapped.localTransportRequired,
                specialRequirements: mapped.specialRequirements,
              },
              'Google Form'
            );
          }
        }
        syncedCount++;
      }

      db.meta.lastSyncedAt = new Date().toISOString();
      saveDatabase(db);
      res.json({
        formTitle: formData.info?.title || 'Google Form',
        syncedCount,
        skippedCount,
        db,
        metrics: computeDashboardMetrics(db),
      });
    } catch (err: any) {
      console.error('Forms sync error:', err);
      res.status(500).json({ error: err?.message || 'Failed to sync Google Form.' });
    }
  });

  app.post('/api/workspace/sheets/fetch', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Google Workspace access token.' });
        return;
      }
      const { spreadsheetId, sheetTitle } = req.body ?? {};
      if (!spreadsheetId || typeof spreadsheetId !== 'string') {
        res.status(400).json({ error: 'Google Spreadsheet ID is required.' });
        return;
      }
      const safeId = encodeURIComponent(spreadsheetId.trim());
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${safeId}?fields=properties.title,sheets.properties.title`,
        { headers: { Authorization: authHeader } }
      );
      const metaData = await metaRes.json();
      if (!metaRes.ok) {
        res.status(metaRes.status).json({ error: metaData?.error?.message || 'Google Sheets API error' });
        return;
      }

      const tabs: string[] = (metaData.sheets || []).map((s: any) => s.properties.title);
      const targetTab = sheetTitle && tabs.includes(sheetTitle) ? sheetTitle : tabs[0];
      if (!targetTab) {
        res.status(400).json({ error: 'Spreadsheet has no readable tabs.' });
        return;
      }

      const range = encodeURIComponent(`${targetTab}!A1:Z500`);
      const valuesRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${safeId}/values/${range}`,
        { headers: { Authorization: authHeader } }
      );
      const valuesData = await valuesRes.json();
      if (!valuesRes.ok) {
        res.status(valuesRes.status).json({ error: valuesData?.error?.message || 'Failed to read Sheet values.' });
        return;
      }

      res.json({
        spreadsheetTitle: metaData.properties?.title || 'Google Sheet',
        tabs,
        activeTab: targetTab,
        values: valuesData.values || [],
      });
    } catch (err: any) {
      console.error('Sheets fetch error:', err);
      res.status(500).json({ error: err?.message || 'Failed to read Google Sheet.' });
    }
  });

  // --- Vite / Static Frontend Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SummitOps server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
