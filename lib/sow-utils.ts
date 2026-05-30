import { SOWStatus, ApprovalAction, ActivityType, UserRole } from '@prisma/client'

/**
 * Check if a user can approve a SOW
 * @param userId - ID of the user trying to approve
 * @param currentApproverId - ID of the assigned approver
 * @param userRole - Role of the user
 * @returns true if user can approve
 */
export function canApproveSQW(
  userId: string,
  currentApproverId: string | null,
  userRole: UserRole
): boolean {
  // ADMINs can always approve
  if (userRole === 'ADMIN') {
    return true
  }

  // Current approver can approve
  if (currentApproverId && userId === currentApproverId) {
    return true
  }

  return false
}

/**
 * Check if a SOW can be sent to subcontractor
 * @param status - Current SOW status
 * @returns true if SOW can be sent
 */
export function canSendSOW(status: SOWStatus): boolean {
  return status === 'APPROVED'
}

/**
 * Check if a new version can be created
 * @param status - Current SOW status
 * @returns true if version can be created
 */
export function canCreateVersion(status: SOWStatus): boolean {
  // Can create version from any status except SUPERSEDED
  return status !== 'SUPERSEDED'
}

/**
 * Get the next status after approval action
 * @param action - Approval action taken
 * @returns New SOW status
 */
export function getStatusAfterApproval(action: ApprovalAction): SOWStatus {
  switch (action) {
    case 'APPROVED':
      return 'APPROVED'
    case 'REJECTED':
      return 'REJECTED'
    case 'CHANGES_REQUESTED':
      return 'DRAFT'
    case 'SUBMITTED':
      return 'PENDING_REVIEW'
    default:
      return 'DRAFT'
  }
}

/**
 * Get activity type from approval action
 * @param action - Approval action
 * @returns Corresponding activity type
 */
export function getActivityTypeFromAction(action: ApprovalAction): ActivityType {
  switch (action) {
    case 'APPROVED':
      return 'APPROVED'
    case 'REJECTED':
      return 'REJECTED'
    case 'SUBMITTED':
    case 'CHANGES_REQUESTED':
    default:
      return 'UPDATED'
  }
}

/**
 * Get status badge color class for UI
 * @param status - SOW status
 * @returns Tailwind CSS classes for badge styling
 */
export function getStatusBadgeColor(status: SOWStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-800'
    case 'PENDING_REVIEW':
      return 'bg-yellow-100 text-yellow-800'
    case 'APPROVED':
      return 'bg-green-100 text-green-800'
    case 'REJECTED':
      return 'bg-red-100 text-red-800'
    case 'SENT':
      return 'bg-blue-100 text-blue-800'
    case 'VIEWED':
      return 'bg-purple-100 text-purple-800'
    case 'ACCEPTED':
      return 'bg-emerald-100 text-emerald-800'
    case 'SUPERSEDED':
      return 'bg-gray-100 text-gray-500'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

/**
 * Get human-readable status label
 * @param status - SOW status
 * @returns Display label for status
 */
export function getStatusLabel(status: SOWStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft'
    case 'PENDING_REVIEW':
      return 'Pending Review'
    case 'APPROVED':
      return 'Approved'
    case 'REJECTED':
      return 'Rejected'
    case 'SENT':
      return 'Sent'
    case 'VIEWED':
      return 'Viewed'
    case 'ACCEPTED':
      return 'Accepted'
    case 'SUPERSEDED':
      return 'Superseded'
    default:
      return status
  }
}

/**
 * Generate SOW filename
 * @param solicitation Number - Opportunity solicitation number
 * @param version - SOW version number
 * @returns Formatted filename
 */
export function generateSOWFileName(solicitationNumber: string, version: number): string {
  const sanitized = solicitationNumber.replace(/[^a-zA-Z0-9]/g, '_')
  const timestamp = new Date().toISOString().split('T')[0]
  return `SOW_${sanitized}_v${version}_${timestamp}.pdf`
}

/**
 * Check if user has permission to view SOW
 * @param userId - User ID
 * @param sow - SOW object with relations
 * @param userRole - User role
 * @returns true if user can view
 */
export function canViewSOW(
  userId: string,
  sow: { generatedById: string | null; currentApproverId: string | null },
  userRole: UserRole
): boolean {
  // ADMIN and VIEWER can view all
  if (userRole === 'ADMIN' || userRole === 'VIEWER') {
    return true
  }

  // Creator can view
  if (sow.generatedById === userId) {
    return true
  }

  // Assigned approver can view
  if (sow.currentApproverId === userId) {
    return true
  }

  // Agents can view by default
  return userRole === 'AGENT'
}

/**
 * Check if user has permission to edit SOW
 * @param userId - User ID
 * @param sow - SOW object with relations
 * @param userRole - User role
 * @returns true if user can edit
 */
export function canEditSOW(
  userId: string,
  sow: { generatedById: string | null; status: SOWStatus },
  userRole: UserRole
): boolean {
  // ADMIN can always edit
  if (userRole === 'ADMIN') {
    return true
  }

  // Only DRAFT and REJECTED SOWs can be edited
  if (sow.status !== 'DRAFT' && sow.status !== 'REJECTED') {
    return false
  }

  // Creator can edit their own DRAFT/REJECTED SOWs
  return sow.generatedById === userId
}
