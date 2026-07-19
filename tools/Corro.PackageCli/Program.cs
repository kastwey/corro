using System.Text;
using Corro.PackageCli;

Console.OutputEncoding = Encoding.UTF8;
return await CliApplication.RunAsync(args, Console.Out, Console.Error);
