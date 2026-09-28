import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../database/prisma.service';

const mockPrismaService = {
  customer: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  address: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn((promises: any[]) => Promise.all(promises)),
};

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  describe('findAll', () => {
    it('returns paginated customers list with search filter', async () => {
      const mockCustomers = [
        {
          id: 'cust_1',
          name: 'John Doe',
          phone: '9876543210',
          addresses: [],
          _count: { orders: 2, addresses: 1 },
        },
      ];
      mockPrismaService.$transaction.mockResolvedValue([mockCustomers, 1]);

      const result = await service.findAll({ search: 'John', page: 1, limit: 10 });

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(result).toEqual({
        items: mockCustomers,
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      });
    });
  });

  describe('findOne', () => {
    it('returns customer by id', async () => {
      const mockCustomer = {
        id: 'cust_1',
        name: 'John Doe',
        phone: '9876543210',
        addresses: [],
        orders: [],
        _count: { orders: 0, addresses: 0, cartItems: 0 },
      };
      mockPrismaService.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await service.findOne('cust_1');
      expect(result).toEqual(mockCustomer);
    });

    it('throws NotFoundException if customer not found', async () => {
      mockPrismaService.customer.findUnique.mockResolvedValue(null);

      await expect(service.findOne('cust_nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes customer with 0 orders', async () => {
      mockPrismaService.customer.findUnique.mockResolvedValue({
        id: 'cust_1',
        _count: { orders: 0 },
      });
      mockPrismaService.customer.delete.mockResolvedValue({ id: 'cust_1' });

      const result = await service.remove('cust_1');
      expect(result).toEqual({ success: true, message: 'Customer deleted successfully' });
      expect(mockPrismaService.customer.delete).toHaveBeenCalledWith({ where: { id: 'cust_1' } });
    });

    it('rejects deletion if customer has existing orders', async () => {
      mockPrismaService.customer.findUnique.mockResolvedValue({
        id: 'cust_1',
        _count: { orders: 3 },
      });

      await expect(service.remove('cust_1')).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.customer.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if customer to delete does not exist', async () => {
      mockPrismaService.customer.findUnique.mockResolvedValue(null);

      await expect(service.remove('cust_nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProfile', () => {
    it('returns customer profile with addresses', async () => {
      const mockProfile = { id: 'cust_1', name: 'John Doe', addresses: [] };
      mockPrismaService.customer.findUnique.mockResolvedValue(mockProfile);

      const result = await service.getProfile('cust_1');
      expect(result).toEqual(mockProfile);
    });
  });
});
