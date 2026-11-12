import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { PrismaService } from '../database/prisma.service';

const mockStaff = {
  id: 'staff-1',
  username: 'admin',
  displayName: 'Admin User',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrismaService = {
  staffUser: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('StaffService', () => {
  let service: StaffService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  describe('create', () => {
    it('should create and return a new staff user', async () => {
      mockPrismaService.staffUser.create.mockResolvedValue(mockStaff);

      const result = await service.create({
        username: 'admin',
        password: 'password123',
        displayName: 'Admin User',
      });

      expect(mockPrismaService.staffUser.create).toHaveBeenCalled();
      expect(result).toEqual(mockStaff);
    });
  });

  describe('findAll', () => {
    it('should return paginated staff list', async () => {
      mockPrismaService.$transaction.mockResolvedValue([[mockStaff], 1]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return a staff member when found', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue(mockStaff);

      const result = await service.findOne('staff-1');
      expect(result).toEqual(mockStaff);
    });

    it('should throw NotFoundException when staff not found', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update staff user details', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue(mockStaff);
      mockPrismaService.staffUser.update.mockResolvedValue({
        ...mockStaff,
        displayName: 'Updated Name',
      });

      const result = await service.update('staff-1', { displayName: 'Updated Name' });
      expect(result.displayName).toBe('Updated Name');
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException if deleting own account', async () => {
      await expect(service.remove('staff-1', 'staff-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if only 1 staff user exists', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue(mockStaff);
      mockPrismaService.staffUser.count.mockResolvedValue(1);

      await expect(service.remove('staff-1', 'staff-2')).rejects.toThrow(BadRequestException);
    });

    it('should delete staff user if valid', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue(mockStaff);
      mockPrismaService.staffUser.count.mockResolvedValue(2);
      mockPrismaService.staffUser.delete.mockResolvedValue(mockStaff);

      const result = await service.remove('staff-1', 'staff-2');
      expect(result).toEqual({ success: true, message: 'Staff user deleted successfully' });
    });
  });

  describe('changePassword', () => {
    it('should throw BadRequestException if new password does not match confirm password', async () => {
      await expect(
        service.changePassword('staff-1', {
          currentPassword: 'oldPass123',
          newPassword: 'newPass123',
          confirmPassword: 'differentPass',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if new password is the same as current password', async () => {
      await expect(
        service.changePassword('staff-1', {
          currentPassword: 'oldPass123',
          newPassword: 'oldPass123',
          confirmPassword: 'oldPass123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if staff is not found', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('nonexistent', {
          currentPassword: 'oldPass123',
          newPassword: 'newPass123',
          confirmPassword: 'newPass123',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if current password does not match', async () => {
      mockPrismaService.staffUser.findUnique.mockResolvedValue({
        id: 'staff-1',
        passwordHash: '$2b$10$invalidhashhere',
      });

      await expect(
        service.changePassword('staff-1', {
          currentPassword: 'wrongPassword',
          newPassword: 'newPassword123',
          confirmPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update password and return success when passwords match', async () => {
      const bcrypt = require('bcrypt');
      const currentHashed = await bcrypt.hash('correctOldPassword', 10);

      mockPrismaService.staffUser.findUnique.mockResolvedValue({
        id: 'staff-1',
        passwordHash: currentHashed,
      });
      mockPrismaService.staffUser.update.mockResolvedValue({ id: 'staff-1' });

      const result = await service.changePassword('staff-1', {
        currentPassword: 'correctOldPassword',
        newPassword: 'brandNewPassword123',
        confirmPassword: 'brandNewPassword123',
      });

      expect(mockPrismaService.staffUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'staff-1' },
          data: expect.objectContaining({
            passwordHash: expect.any(String),
          }),
        }),
      );
      expect(result).toEqual({
        success: true,
        message: 'Password changed successfully',
      });
    });
  });
});
