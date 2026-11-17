import { z } from 'zod';
import prisma from '../config/prisma.js';
import { requireApprovedCompany } from '../middlewares/auth.js';
import { uploadFile } from '../utils/storage.js';
import { notifyAdmins } from '../services/notificationService.js';

const MAX_COMPANY_DOCUMENTS = 4;

// Schemas
const companyRegisterSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  ownerName: z.string().min(2, 'Owner name is required'),
  phone: z.string().min(8, 'Phone number is required'),
  email: z.string().email('Invalid email address'),
  city: z.string().min(2, 'City is required'),
  ntnCnic: z.string().min(5, 'NTN or CNIC is required'),
  documentUrl: z.string().optional(),
});

const statusUpdateSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
  rejectionReason: z.string().optional(),
});

/**
 * Organizer submits company registration
 */
export const registerCompany = async (req, res) => {
  try {
    const userId = req.user.id;

    // Validate body
    const validated = companyRegisterSchema.parse(req.body);

    // Check if company already registered for this organizer
    const existingCompany = await prisma.company.findUnique({
      where: { userId },
    });
    // One organization per user: a member of another organization can't register a company of their own
    const otherMembership = await prisma.organizationMember.findFirst({
      where: { userId, status: { not: 'REMOVED' }, ...(existingCompany ? { companyId: { not: existingCompany.id } } : {}) },
      select: { id: true },
    });
    if (otherMembership) {
      return res.status(409).json({ success: false, message: 'You are already a member of an organization. Leave it before registering your own company.' });
    }

    // Checked before anything is uploaded, so a refused request stores no files
    if (existingCompany?.status === 'APPROVED') {
      return res.status(400).json({
        success: false,
        message: 'Your company is already approved. Contact admin for any corporate modifications.',
      });
    }

    // Verification documents: 1 to 4 files sent as multipart `documents` (or the older single `document`).
    // Without new files, a resubmission keeps the documents already on file; a JSON `documentUrl` also counts.
    const files = [...(req.files?.documents || []), ...(req.files?.document || [])];
    if (files.length > MAX_COMPANY_DOCUMENTS) {
      return res.status(400).json({ success: false, message: `You can upload at most ${MAX_COMPANY_DOCUMENTS} documents.` });
    }
    let documentUrls;
    if (files.length) {
      documentUrls = [];
      for (const file of files) documentUrls.push((await uploadFile(file, 'company_docs')).url);
    } else if (existingCompany) {
      documentUrls = existingCompany.documentUrls?.length ? existingCompany.documentUrls : [existingCompany.documentUrl].filter(Boolean);
    } else if (validated.documentUrl) {
      documentUrls = [validated.documentUrl];
    }
    if (!documentUrls?.length) {
      return res.status(400).json({ success: false, message: 'Upload at least one verification document (NTN certificate, FBR registration or CNIC scan).' });
    }
    // documentUrl keeps the first document for screens that show a single link
    const documentUrl = documentUrls[0];

    let company;
    if (existingCompany) {
      // Update and reset to PENDING if previously REJECTED or PENDING
      company = await prisma.company.update({
        where: { id: existingCompany.id },
        data: {
          companyName: validated.companyName,
          ownerName: validated.ownerName,
          phone: validated.phone,
          email: validated.email,
          city: validated.city,
          ntnCnic: validated.ntnCnic,
          documentUrl,
          documentUrls,
          status: 'PENDING',
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      });
    } else {
      company = await prisma.company.create({
        data: {
          userId,
          companyName: validated.companyName,
          ownerName: validated.ownerName,
          phone: validated.phone,
          email: validated.email,
          city: validated.city,
          ntnCnic: validated.ntnCnic,
          documentUrl,
          documentUrls,
          status: 'PENDING',
        },
      });
    }

    // New verification files also go into the organization's document library
    if (files.length) {
      await prisma.companyDocument.createMany({
        data: files.map((file, i) => ({ companyId: company.id, type: 'VERIFICATION', title: file.originalname?.slice(0, 120) || `Verification document ${i + 1}`, url: documentUrls[i], mimeType: file.mimetype, sizeBytes: file.size, uploadedById: userId })),
      });
    }
    // A new organization starts with its head office at the registered city
    if (!existingCompany) {
      await prisma.companyBranch.create({ data: { companyId: company.id, name: 'Head office', isHeadOffice: true, city: company.city, phone: company.phone, email: company.email, createdById: userId } }).catch(() => {});
    }

    // Link the organizer account to its company and make it the organization's owner
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { companyId: company.id } }),
      prisma.organizationMember.upsert({
        where: { companyId_userId: { companyId: company.id, userId } },
        update: {},
        create: { companyId: company.id, userId, role: 'OWNER', status: 'ACTIVE' },
      }),
    ]);

    // Create confirmation in-app notification
    await prisma.notification.create({
      data: {
        userId,
        type: 'ORGANIZER_REGISTRATION',
        title: 'Company Verification Submitted',
        message: `Your registration for "${company.companyName}" has been received and is pending Super Admin approval.`,
      },
    });

    // Ask the admins to review it
    const resubmitted = existingCompany?.status === 'REJECTED';
    await notifyAdmins({
      type: 'ADMIN_COMPANY_REVIEW_REQUEST',
      title: `${resubmitted ? 'Organizer registration resubmitted' : 'New organizer registration'}: ${company.companyName}`,
      message: `${company.companyName} (${company.ownerName}, ${company.city}) ${resubmitted ? 'corrected and resubmitted its' : 'submitted a'} company verification with ${documentUrls.length} document${documentUrls.length === 1 ? '' : 's'}. Please review it and approve or reject the request.`,
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'COMPANY_SUBMITTED',
        targetType: 'Company',
        targetId: company.id,
        details: { companyName: company.companyName, ntnCnic: company.ntnCnic },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Company registration submitted successfully. Pending administrative verification.',
      data: { company },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.errors[0]?.message || 'Validation error',
      });
    }
    console.error('Company registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit company registration',
      error: error.message,
    });
  }
};

/**
 * Organizer fetches their company status
 */
export const getMyCompany = async (req, res) => {
  try {
    const userId = req.user.id;

    // The organization of the user's open membership (owners and employees), else one they registered
    const membership = await prisma.organizationMember.findFirst({ where: { userId, status: { not: 'REMOVED' } }, select: { companyId: true, role: true } });
    let company = await prisma.company.findUnique({
      where: membership ? { id: membership.companyId } : { userId },
      include: {
        events: {
          select: { id: true, name: true, status: true, date: true },
        },
      },
    });

    // Verification documents and tax numbers are for owners and admins only
    if (company && membership && !['OWNER', 'ADMIN'].includes(membership.role)) {
      const { ntnCnic, documentUrl, documentUrls, rejectionReason, ...rest } = company;
      company = rest;
    }

    return res.status(200).json({
      success: true,
      data: { company },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve company details',
      error: error.message,
    });
  }
};

/**
 * Super Admin lists all companies with optional status filter
 */
export const getAllCompanies = async (req, res) => {
  try {
    const { status } = req.query;

    const where = {};
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    const companies = await prisma.company.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            walletAddress: true,
          },
        },
        _count: {
          select: { events: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Count summaries for tabs
    const counts = {
      all: await prisma.company.count(),
      pending: await prisma.company.count({ where: { status: 'PENDING' } }),
      approved: await prisma.company.count({ where: { status: 'APPROVED' } }),
      rejected: await prisma.company.count({ where: { status: 'REJECTED' } }),
      suspended: await prisma.company.count({ where: { status: 'SUSPENDED' } }),
    };

    return res.status(200).json({
      success: true,
      data: {
        companies,
        counts,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch companies',
      error: error.message,
    });
  }
};

/**
 * Super Admin updates company status (Approve / Reject / Suspend)
 */
export const updateCompanyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const validated = statusUpdateSchema.parse(req.body);
    const adminUser = req.user;

    const company = await prisma.company.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    if (validated.status === 'REJECTED' && !validated.rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'A rejection reason is required when rejecting a company registration.',
      });
    }

    const updated = await prisma.company.update({
      where: { id },
      data: {
        status: validated.status,
        rejectionReason: validated.status === 'REJECTED' ? validated.rejectionReason : null,
        reviewedBy: adminUser.email,
        reviewedAt: new Date(),
      },
    });

    // Notify the organizer
    let notifTitle = '';
    let notifMessage = '';

    if (validated.status === 'APPROVED') {
      notifTitle = 'Company Registration Approved! 🎉';
      notifMessage = `Congratulations! "${company.companyName}" is officially approved. You can now create and manage events.`;
    } else if (validated.status === 'REJECTED') {
      notifTitle = 'Company Registration Rejected';
      notifMessage = `Your company verification was rejected: ${validated.rejectionReason}. Please correct details and resubmit.`;
    } else if (validated.status === 'SUSPENDED') {
      notifTitle = 'Company Suspended';
      notifMessage = `Your company "${company.companyName}" has been temporarily suspended by TicketLedger administration.`;
    }

    await prisma.notification.create({
      data: {
        userId: company.userId,
        type: 'ORGANIZER_STATUS_UPDATE',
        title: notifTitle,
        message: notifMessage,
      },
    });

    // Confirm the decision to the admins (the reviewer and the rest of the team)
    const decision = { APPROVED: 'approved', REJECTED: 'rejected', SUSPENDED: 'suspended' }[validated.status] || validated.status.toLowerCase();
    await notifyAdmins({
      type: 'ADMIN_COMPANY_REVIEWED',
      title: `Organizer ${decision}: ${company.companyName}`,
      message:
        `${adminUser.email} ${decision} the organizer registration for "${company.companyName}". The organizer has been notified.` +
        (validated.status === 'REJECTED' ? ` Rejection reason: ${validated.rejectionReason}` : ''),
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: adminUser.id,
        action: `COMPANY_${validated.status}`,
        targetType: 'Company',
        targetId: company.id,
        details: {
          previousStatus: company.status,
          newStatus: validated.status,
          rejectionReason: validated.rejectionReason || null,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Company ${company.companyName} status changed to ${validated.status}.`,
      data: { company: updated },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.errors[0]?.message || 'Validation error',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to update company status',
      error: error.message,
    });
  }
};

// Kept for existing imports; the guard now lives in middlewares/auth.js
export const requireApprovedOrganizer = requireApprovedCompany('event.create');
