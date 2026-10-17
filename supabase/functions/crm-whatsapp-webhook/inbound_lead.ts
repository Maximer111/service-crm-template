type InboundLeadEligibility = {
    fromMe: boolean;
    phone: string;
    hasLead: boolean;
    suppressed: boolean;
    internalPhone: boolean;
};
export function shouldCreateInboundLead(input: InboundLeadEligibility): boolean {
    return !input.fromMe
        && /^\d{10,15}$/.test(input.phone)
        && !input.hasLead
        && !input.suppressed
        && !input.internalPhone;
}
type InboundConversationEligibility = {
    enabled: boolean;
    suppressed: boolean;
    body: string;
    messageType: string;
    leadSource?: string;
};
export function shouldQueueInboundConversation(input: InboundConversationEligibility): boolean {
    return input.enabled
        && !input.suppressed
        && String(input.leadSource ?? "") !== "job_application"
        && (Boolean(input.body.trim()) || ["image", "audio"].includes(input.messageType));
}
export function isInboundConversationLeadEligible(status: string, bookedAcknowledgement: boolean): boolean {
    return bookedAcknowledgement || ["contacted", "in_progress", "follow_up"].includes(status);
}
