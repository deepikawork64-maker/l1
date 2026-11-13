import { GoogleGenAI, Type } from '@google/genai';
import type { ResponseStatus } from '../src/types/event.ts';

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export interface EmailClassificationResult {
  detectedStatus: ResponseStatus;
  confidence: number;
  aiRationale: string;
  matchedInviteeIdHint: string | null;
  originalSenderEmail: string | null;
  originalSenderName: string | null;
  extractedLogistics: {
    summary: string | null;
    arrivalDate: string;
    arrivalTime: string;
    departureDate: string;
    departureTime: string;
    travelMode: 'Flight' | 'Train' | 'Road / Self' | 'Local / No Travel' | '';
    carrierDetails: string;
    accommodationRequired: boolean | null;
    hotelCheckIn: string;
    hotelCheckOut: string;
    airportPickupRequired: boolean | null;
    airportDropRequired: boolean | null;
    specialRequirements: string;
  };
}

export async function classifyEmailResponseWithGemini(input: {
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  eventContext: string;
}): Promise<EmailClassificationResult> {
  const ai = getAiClient();

  const prompt = `
Analyze the following event invitation email reply and classify the invitee's response status and extract any travel/logistics details.

Event Context: ${input.eventContext}
Sender: ${input.senderName} <${input.senderEmail}>
Subject: ${input.subject}
Email Body:
"""
${input.body.slice(0, 6000)}
"""

Classification Rules:
- "Confirmation Received": Unambiguous acceptance / confirmation of attendance.
- "Regret Received": Unambiguous decline / inability to attend.
- "Response Pending Verification": Tentative ("maybe", "trying to adjust"), conditional ("pending clearance"), proxy/delegate substitution ("sending colleague instead"), or ambiguous/automated out-of-office reply.
- Confidence: 0-100 integer. If confidence < 85 or the reply has caveats/proxies, prefer "Response Pending Verification".
- Look for any Invitee ID pattern like INV-2026-001 in subject or body.
- If the email appears to be forwarded from an office mailbox (e.g. "Forwarded message" / "From: ..."), extract the original invitee's email and name into originalSenderEmail / originalSenderName, otherwise null.
- Extract any dates in YYYY-MM-DD format and times in HH:MM 24h format where mentioned, otherwise empty string "".
`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are an executive event protocol analyst. Return accurate JSON matching the schema without fabricating travel details not present in the email.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedStatus: {
            type: Type.STRING,
            enum: ['Confirmation Received', 'Regret Received', 'Response Pending Verification'],
          },
          confidence: { type: Type.INTEGER },
          aiRationale: { type: Type.STRING },
          matchedInviteeIdHint: { type: Type.STRING, nullable: true },
          originalSenderEmail: { type: Type.STRING, nullable: true },
          originalSenderName: { type: Type.STRING, nullable: true },
          extractedLogistics: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, nullable: true },
              arrivalDate: { type: Type.STRING },
              arrivalTime: { type: Type.STRING },
              departureDate: { type: Type.STRING },
              departureTime: { type: Type.STRING },
              travelMode: {
                type: Type.STRING,
                enum: ['Flight', 'Train', 'Road / Self', 'Local / No Travel', ''],
              },
              carrierDetails: { type: Type.STRING },
              accommodationRequired: { type: Type.BOOLEAN, nullable: true },
              hotelCheckIn: { type: Type.STRING },
              hotelCheckOut: { type: Type.STRING },
              airportPickupRequired: { type: Type.BOOLEAN, nullable: true },
              airportDropRequired: { type: Type.BOOLEAN, nullable: true },
              specialRequirements: { type: Type.STRING },
            },
            required: [
              'arrivalDate',
              'arrivalTime',
              'departureDate',
              'departureTime',
              'travelMode',
              'carrierDetails',
              'specialRequirements',
            ],
          },
        },
        required: ['detectedStatus', 'confidence', 'aiRationale', 'extractedLogistics'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as EmailClassificationResult;
  return parsed;
}

export async function normalizeFormSubmissionWithGemini(input: {
  formTitle: string;
  qaPairs: Array<{ question: string; answer: string }>;
  respondentEmail: string | null;
}): Promise<{
  inviteeIdHint: string | null;
  name: string;
  email: string;
  phone: string;
  organisation: string;
  rsvpStatus: ResponseStatus;
  logisticsSummary: string;
  arrivalDate: string;
  arrivalTime: string;
  departureDate: string;
  departureTime: string;
  travelMode: 'Flight' | 'Train' | 'Road / Self' | 'Local / No Travel' | '';
  carrierDetails: string;
  accommodationRequired: boolean;
  hotelCheckIn: string;
  hotelCheckOut: string;
  roomTypePreference: string;
  airportPickupRequired: boolean;
  airportDropRequired: boolean;
  localTransportRequired: boolean;
  specialRequirements: string;
}> {
  const ai = getAiClient();

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Map this Google Form submission ("${input.formTitle}") from respondent email "${input.respondentEmail ?? ''}" into structured RSVP and logistics fields:\n${JSON.stringify(input.qaPairs, null, 2)}`,
    config: {
      systemInstruction:
        'Normalize form Q&A responses into strict JSON. Use YYYY-MM-DD for dates and HH:MM for times when present, else "".',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          inviteeIdHint: { type: Type.STRING, nullable: true },
          name: { type: Type.STRING },
          email: { type: Type.STRING },
          phone: { type: Type.STRING },
          organisation: { type: Type.STRING },
          rsvpStatus: {
            type: Type.STRING,
            enum: ['Confirmation Received', 'Regret Received', 'Response Pending Verification'],
          },
          logisticsSummary: { type: Type.STRING },
          arrivalDate: { type: Type.STRING },
          arrivalTime: { type: Type.STRING },
          departureDate: { type: Type.STRING },
          departureTime: { type: Type.STRING },
          travelMode: {
            type: Type.STRING,
            enum: ['Flight', 'Train', 'Road / Self', 'Local / No Travel', ''],
          },
          carrierDetails: { type: Type.STRING },
          accommodationRequired: { type: Type.BOOLEAN },
          hotelCheckIn: { type: Type.STRING },
          hotelCheckOut: { type: Type.STRING },
          roomTypePreference: { type: Type.STRING },
          airportPickupRequired: { type: Type.BOOLEAN },
          airportDropRequired: { type: Type.BOOLEAN },
          localTransportRequired: { type: Type.BOOLEAN },
          specialRequirements: { type: Type.STRING },
        },
        required: [
          'name',
          'email',
          'rsvpStatus',
          'logisticsSummary',
          'arrivalDate',
          'arrivalTime',
          'departureDate',
          'departureTime',
          'travelMode',
          'carrierDetails',
          'accommodationRequired',
          'hotelCheckIn',
          'hotelCheckOut',
          'roomTypePreference',
          'airportPickupRequired',
          'airportDropRequired',
          'localTransportRequired',
          'specialRequirements',
        ],
      },
    },
  });

  return JSON.parse((response.text ?? '{}').trim());
}
