const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomBytes } = require("crypto");
const { promisify } = require("util");

const Mutations = {
	async createItem(parent, args, ctx, info) {
		// TODO: Check if they are logged in

		const item = await ctx.db.mutation.createItem(
			{
				data: {
					...args
				}
			},
			info
		);

		return item;
	},
	updateItem(parent, args, ctx, info) {
		// first take a copy of the updates
		const updates = { ...args };
		// remove the ID from the updates
		delete updates.id;
		// run the update method
		return ctx.db.mutation.updateItem(
			{
				data: updates,
				where: {
					id: args.id
				}
			},
			info
		);
	},
	async deleteItem(parent, args, ctx, info) {
		const where = { id: args.id };
		// 1. find the item
		const item = await ctx.db.query.item({ where }, `{ id title}`);
		// 2. check if they own that item, or have the permissions
		// TODO
		// 3. delete it
		return ctx.db.mutation.deleteItem({ where }, info);
	},
	async signup(parent, args, ctx, info) {
		args.email = args.email.toLowerCase();
		// hash the user password
		const password = await bcrypt.hash(args.password, 10);
		// create the user in the db
		const user = await ctx.db.mutation.createUser(
			{
				data: {
					...args,
					password,
					permissions: { set: ["USER"] }
				}
			},
			info
		);
		// create the JWT token for the user
		const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
		// set the jwt as a cookie on the response
		ctx.response.cookie("token", token, {
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year cookie
		});
		// return the user to the browser
		return user;
	},
	async signin(parent, { email, password }, ctx, info) {
		// 1. check if there is a user with that email
		const user = await ctx.db.query.user({ where: { email } });
		if (!user) {
			throw new Error(`No such user found for email ${email}`);
		}
		// 2. check if their password is correct
		const valid = await bcrypt.compare(password, user.password);
		if (!valid) {
			throw new Error("Invalid Password!");
		}
		// 3. generate the JWT token
		const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
		// 4. set the cookie with the token
		ctx.response.cookie("token", token, {
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year cookie
		});
		// 5. return the user
		return user;
	},
	signout(parent, args, ctx, info) {
		ctx.response.clearCookie("token");
		return { message: "Goodbye!" };
	},
	async requestReset(parent, args, ctx, info) {
		// 1. check if this is a real user
		const user = await ctx.db.query.user({ where: { email: args.email } });
		if (!user) {
			throw new Error(`No such user found for email ${args.email}`);
		}
		// 2. set a reset token and expirey on that user
		const randomBytesPromisified = promisify(randomBytes);
		const resetToken = (await randomBytesPromisified(20)).toString("hex");
		const resetTokenExpiry = Date.now() + 3600000; // 1h from now
		const res = await ctx.db.mutation.updateUser({
			where: { email: args.email },
			data: { resetToken, resetTokenExpiry }
		});
		return { message: "Thanks!" };
		// 3. send the reset token via email
	},
	async resetPassword(parent, args, ctx, info) {
		// 1. check if the passwods match
		if (args.password !== args.confirmPassword) {
			throw new Error("Passwords don't match!");
		}
		// 2. chek if it's a legit reset token
		// 3. check if it's expired
		const [user] = await ctx.db.query.users({
			where: {
				resetToken: args.resetToken,
				resetTokenExpiry_gte: Date.now() - 3600000
			}
		});
		if (!user) {
			throw new Error("This token is either invalid or expired!");
		}
		// 4. hash their new password
		const password = await bcrypt.hash(args.password, 10);
		// 5. save the new password to the user and remove the old resetToken fields
		const updatedUser = await ctx.db.mutation.updateUser({
			where: { email: user.email },
			data: {
				password,
				resetToken: null,
				resetTokenExpiry: null
			}
		});
		// 6. generate JWT
		const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
		// 7. set the JWT cookie
		ctx.response.cookie("token", token, {
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24 * 365
		});
		// 8. return the new user
		return updatedUser;
	}
};

module.exports = Mutations;
