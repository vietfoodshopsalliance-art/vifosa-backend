import mongoose, { Schema, Document, Model } from 'mongoose'

// ─── Reviews ─────────────────────────────────────────────────────────────────

export interface IReview extends Document {
  orderId: mongoose.Types.ObjectId
  fromUserId: mongoose.Types.ObjectId
  toEntityType: 'store' | 'customer'
  toEntityId: mongoose.Types.ObjectId
  stars: 1 | 2 | 3 | 4 | 5
  comment: string
  images: string[]
  isAnonymous: boolean
  reply: {
    text: string
    at: Date
    editedAt?: Date
  } | null
  isHiddenByAdmin: boolean
  createdAt: Date
  editedAt: Date | null
}

const ReviewSchema = new Schema<IReview>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: [true, 'orderId là bắt buộc'],
    },
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'fromUserId là bắt buộc'],
    },
    toEntityType: {
      type: String,
      enum: ['store', 'customer'],
      required: [true, 'toEntityType là bắt buộc'],
    },
    toEntityId: {
      type: Schema.Types.ObjectId,
      required: [true, 'toEntityId là bắt buộc'],
    },
    stars: {
      type: Number,
      required: [true, 'Số sao là bắt buộc'],
      min: [1, 'Số sao tối thiểu 1'],
      max: [5, 'Số sao tối đa 5'],
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: 'Số sao phải là số nguyên',
      },
    },
    comment: {
      type: String,
      default: '',
      maxlength: [2000, 'Nhận xét tối đa 2000 ký tự'],
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 3,
        message: 'Tối đa 3 ảnh cho mỗi đánh giá',
      },
    },
    isAnonymous: { type: Boolean, default: false },
    reply: {
      type: new Schema(
        {
          text: { type: String, required: true, maxlength: 2000 },
          at: { type: Date, required: true, default: Date.now },
          editedAt: { type: Date },
        },
        { _id: false }
      ),
      default: null,
    },
    isHiddenByAdmin: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'reviews',
  }
)

ReviewSchema.index({ toEntityId: 1, toEntityType: 1, createdAt: -1 })
ReviewSchema.index({ orderId: 1 }, { unique: true }) // 1 review/order
ReviewSchema.index({ fromUserId: 1 })
ReviewSchema.index({ isHiddenByAdmin: 1 })

export const Review: Model<IReview> =
  mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema)

// ─── Posts ───────────────────────────────────────────────────────────────────

export interface IPost extends Document {
  userId: mongoose.Types.ObjectId
  images: string[]
  caption: string
  taggedItemId: mongoose.Types.ObjectId | null
  taggedStoreId: mongoose.Types.ObjectId | null
  visibility: 'public' | 'private'
  isHidden: boolean
  commentsDisabled: boolean
  blockedCommentUserIds: mongoose.Types.ObjectId[]
  likesCount: number
  createdAt: Date
}

const PostSchema = new Schema<IPost>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId là bắt buộc'],
    },
    images: {
      type: [String],
      required: true,
      validate: [
        {
          validator: (v: string[]) => v.length >= 1,
          message: 'Post phải có ít nhất 1 ảnh',
        },
        {
          validator: (v: string[]) => v.length <= 5,
          message: 'Post tối đa 5 ảnh',
        },
      ],
    },
    caption: {
      type: String,
      default: '',
      maxlength: [2000, 'Caption tối đa 2000 ký tự'],
    },
    taggedItemId: {
      type: Schema.Types.ObjectId,
      ref: 'MenuItem',
      default: null,
    },
    taggedStoreId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
    },
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    isHidden: { type: Boolean, default: false },
    commentsDisabled: { type: Boolean, default: false },
    blockedCommentUserIds: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    likesCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'posts',
  }
)

PostSchema.index({ userId: 1, createdAt: -1 })
PostSchema.index({ visibility: 1, isHidden: 1, createdAt: -1 })
PostSchema.index({ taggedStoreId: 1 })
PostSchema.index({ taggedItemId: 1 })

export const Post: Model<IPost> = mongoose.models.Post || mongoose.model<IPost>('Post', PostSchema)

// ─── Comments ────────────────────────────────────────────────────────────────

export interface IComment extends Document {
  postId: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  text: string
  parentCommentId: mongoose.Types.ObjectId | null
  isDeleted: boolean
  createdAt: Date
}

const CommentSchema = new Schema<IComment>(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: [true, 'postId là bắt buộc'],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId là bắt buộc'],
    },
    text: {
      type: String,
      required: [true, 'Nội dung comment là bắt buộc'],
      maxlength: [1000, 'Comment tối đa 1000 ký tự'],
    },
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'comments',
  }
)

CommentSchema.index({ postId: 1, createdAt: 1 })
CommentSchema.index({ parentCommentId: 1 })

export const Comment: Model<IComment> =
  mongoose.models.Comment || mongoose.model<IComment>('Comment', CommentSchema)

// ─── Likes ───────────────────────────────────────────────────────────────────

export interface ILike extends Document {
  userId: mongoose.Types.ObjectId
  targetType: 'post' | 'item' | 'store'
  targetId: mongoose.Types.ObjectId
  createdAt: Date
}

const LikeSchema = new Schema<ILike>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId là bắt buộc'],
    },
    targetType: {
      type: String,
      enum: ['post', 'item', 'store'],
      required: [true, 'targetType là bắt buộc'],
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: [true, 'targetId là bắt buộc'],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'likes',
  }
)

// unique: 1 user chỉ like 1 lần mỗi target
LikeSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true })
LikeSchema.index({ targetId: 1, targetType: 1 })

export const Like: Model<ILike> = mongoose.models.Like || mongoose.model<ILike>('Like', LikeSchema)
