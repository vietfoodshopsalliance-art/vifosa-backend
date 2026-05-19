import mongoose, { Schema, Document, Model } from 'mongoose'

// ─── MenuCategory ────────────────────────────────────────────────────────────

export interface IMenuCategory extends Document {
  storeId: mongoose.Types.ObjectId
  name: string
  displayOrder: number
  createdAt: Date
  updatedAt: Date
}

const MenuCategorySchema = new Schema<IMenuCategory>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'storeId là bắt buộc'],
    },
    name: {
      type: String,
      required: [true, 'Tên danh mục là bắt buộc'],
      trim: true,
      minlength: [1, 'Tên danh mục tối thiểu 1 ký tự'],
      maxlength: [60, 'Tên danh mục tối đa 60 ký tự'],
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'menu_categories',
  }
)

MenuCategorySchema.index({ storeId: 1, displayOrder: 1 })

export const MenuCategory: Model<IMenuCategory> =
  mongoose.models.MenuCategory || mongoose.model<IMenuCategory>('MenuCategory', MenuCategorySchema)

// ─── MenuItem ────────────────────────────────────────────────────────────────

export interface IMenuItem extends Document {
  storeId: mongoose.Types.ObjectId
  categoryId: mongoose.Types.ObjectId | null
  name: string
  description: string
  price: number
  images: string[]
  stock: number | null // null = không quản lý tồn kho
  status: 'active' | 'closed' | 'paused'
  soldCount: {
    allTime: number
    last7d: number
    last30d: number
    last365d: number
  }
  isDeleted: boolean
  createdAt: Date
  updatedAt: Date
}

const MenuItemSchema = new Schema<IMenuItem>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'storeId là bắt buộc'],
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'MenuCategory',
      default: null,
    },
    name: {
      type: String,
      required: [true, 'Tên món là bắt buộc'],
      trim: true,
      minlength: [1, 'Tên món tối thiểu 1 ký tự'],
      maxlength: [200, 'Tên món tối đa 200 ký tự'],
    },
    description: {
      type: String,
      default: '',
      maxlength: [1000, 'Mô tả tối đa 1000 ký tự'],
    },
    price: {
      type: Number,
      required: [true, 'Giá món là bắt buộc'],
      min: [0, 'Giá không được âm'],
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 5,
        message: 'Tối đa 5 ảnh cho mỗi món',
      },
    },
    stock: {
      type: Number,
      default: null,
      min: [0, 'Tồn kho không được âm'],
    },
    status: {
      type: String,
      enum: ['active', 'closed', 'paused'],
      default: 'active',
    },
    soldCount: {
      type: new Schema(
        {
          allTime: { type: Number, default: 0, min: 0 },
          last7d: { type: Number, default: 0, min: 0 },
          last30d: { type: Number, default: 0, min: 0 },
          last365d: { type: Number, default: 0, min: 0 },
        },
        { _id: false }
      ),
      default: () => ({ allTime: 0, last7d: 0, last30d: 0, last365d: 0 }),
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'menu_items',
  }
)

// Text index cho tìm kiếm — default_language 'none' để không stemming tiếng Anh
MenuItemSchema.index(
  { name: 'text', description: 'text' },
  { default_language: 'none', name: 'menu_items_text' }
)
MenuItemSchema.index({ storeId: 1, status: 1 })
MenuItemSchema.index({ storeId: 1, categoryId: 1 })
MenuItemSchema.index({ storeId: 1, isDeleted: 1 })
MenuItemSchema.index({ 'soldCount.last30d': -1 })

// Hook: tự động ẩn món khi tồn kho về 0
MenuItemSchema.pre('save', async function () {
  if (this.stock !== null && this.stock === 0 && this.status === 'active') {
    this.status = 'paused'
  }
})

MenuItemSchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate() as any
  const stock = update?.$set?.stock ?? update?.stock
  if (stock === 0) {
    if (update.$set) update.$set.status = 'paused'
    else update.status = 'paused'
  }
})

export const MenuItem: Model<IMenuItem> =
  mongoose.models.MenuItem || mongoose.model<IMenuItem>('MenuItem', MenuItemSchema)
